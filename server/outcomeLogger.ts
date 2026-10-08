import { existsSync, promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import type { PriceData } from './ibGateway.js';

// Resolved from the working directory so the same code works under tsx (cwd=server/)
// and inside the bundled Vercel function (cwd=/var/task, data/ copied alongside).
function resolveDataDir(): string {
  const candidates = [
    process.env.NR1_DATA_DIR,
    path.resolve(process.cwd(), 'data'),
    path.resolve(process.cwd(), 'server', 'data'),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

const DATA_DIR        = resolveDataDir();
const DATA_FILE       = path.join(DATA_DIR, 'training_dataset.json');
const HISTORICAL_FILE = path.join(DATA_DIR, 'training_dataset_historical.json');

export interface TrainingExample {
  id: string;
  timestamp: string;
  asset: string;
  timeframe: string;
  timeframe_minutes: number;
  volatility_regime: string;
  event_text: string;
  event_type_encoded: number;
  asset_encoded: number;
  session: number;
  day_of_week: number;
  price_at_run: number | null;
  price_at_outcome: number | null;
  actual_move_pct: number | null;
  actual_bin: number | null;
  signal_direction: string;
  signal_confidence: number;
  nn_predicted_bins: number[];
  agent_directions: Record<string, string>;
  outcome_captured: boolean;
  outcome_timestamp: string | null;
  // When the outcome price should be read. Persisted so pending captures survive restarts.
  outcome_due_at?: string | null;
  // Set when the server was offline too long past the due time to label honestly.
  outcome_missed?: boolean;
}

// Simple write mutex — queues writes so the JSON file never corrupts
let writeLock: Promise<void> = Promise.resolve();

// Must match assign_bin() in pipeline/build_dataset.py
export function assignBin(movePct: number): number {
  if (movePct < -2.5) return 0;
  if (movePct < -1.5) return 1;
  if (movePct < -0.5) return 2;
  if (movePct <  0.5) return 3;
  if (movePct <  1.5) return 4;
  if (movePct <  2.5) return 5;
  return 6;
}

async function readJson(file: string): Promise<TrainingExample[] | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as TrainingExample[];
  } catch {
    return null;
  }
}

// The live file is git-ignored. Until the first run (or the pipeline) creates it,
// fall back to the committed historical examples so a fresh clone can still train.
async function readDataset(): Promise<TrainingExample[]> {
  return (await readJson(DATA_FILE)) ?? (await readJson(HISTORICAL_FILE)) ?? [];
}

async function writeDataset(dataset: TrainingExample[]): Promise<void> {
  await fs.writeFile(DATA_FILE, JSON.stringify(dataset, null, 2), 'utf-8');
}

function queueWrite(fn: () => Promise<void>): Promise<void> {
  writeLock = writeLock.then(fn).catch((err) => {
    console.error('[OutcomeLogger] Write error:', err);
  });
  return writeLock;
}

// How late a capture may be before the price no longer represents the horizon:
// 5% of the timeframe, but at least an hour (1W → ~8.4h, 1M → 36h).
function captureToleranceMs(timeframeMinutes: number): number {
  return Math.max(60 * 60_000, timeframeMinutes * 60_000 * 0.05);
}

export const outcomeLogger = {
  logRun(
    example: Omit<TrainingExample, 'id' | 'price_at_outcome' | 'actual_move_pct' | 'actual_bin' | 'outcome_captured' | 'outcome_timestamp' | 'outcome_due_at'>
  ): string {
    const id = randomUUID();
    const dueAt = example.price_at_run !== null
      ? new Date(Date.parse(example.timestamp) + example.timeframe_minutes * 60_000).toISOString()
      : null;
    const full: TrainingExample = {
      ...example,
      id,
      price_at_outcome: null,
      actual_move_pct: null,
      actual_bin: null,
      outcome_captured: false,
      outcome_timestamp: null,
      outcome_due_at: dueAt,
    };

    queueWrite(async () => {
      const dataset = await readDataset();
      dataset.push(full);
      await writeDataset(dataset);
    });

    if (dueAt) console.log(`[OutcomeLogger] Outcome for ${id} due ${dueAt}`);
    return id;
  },

  // Capture every outcome whose due time has passed. Runs on an interval instead of one
  // setTimeout per run: Node clamps delays above ~24.8 days to 1ms (so 1M runs fired
  // instantly), and in-memory timers were lost whenever the server restarted.
  async captureDueOutcomes(getPrice: (asset: string) => Promise<PriceData>): Promise<void> {
    const now = Date.now();
    const pending = (await readDataset()).filter(
      (e) => !e.outcome_captured && !e.outcome_missed && e.price_at_run !== null &&
             e.outcome_due_at && Date.parse(e.outcome_due_at) <= now
    );
    if (pending.length === 0) return;

    const updates = new Map<string, Partial<TrainingExample>>();
    for (const e of pending) {
      const lateMs = now - Date.parse(e.outcome_due_at!);
      if (lateMs > captureToleranceMs(e.timeframe_minutes)) {
        updates.set(e.id, { outcome_missed: true });
        console.log(`[OutcomeLogger] Outcome for ${e.id} missed (server offline ${(lateMs / 3_600_000).toFixed(1)}h past due)`);
        continue;
      }
      const priceData = await getPrice(e.asset);
      if (priceData.mid === null) continue; // IB offline — retry on the next sweep
      const actual_move_pct = ((priceData.mid - e.price_at_run!) / e.price_at_run!) * 100;
      const actual_bin = assignBin(actual_move_pct);
      updates.set(e.id, {
        price_at_outcome: priceData.mid,
        actual_move_pct,
        actual_bin,
        outcome_captured: true,
        outcome_timestamp: new Date().toISOString(),
      });
      console.log(`[OutcomeLogger] Outcome captured for ${e.id}: ${actual_move_pct.toFixed(3)}% → bin ${actual_bin}`);
    }
    if (updates.size === 0) return;

    await queueWrite(async () => {
      const dataset = await readDataset();
      for (let i = 0; i < dataset.length; i++) {
        const u = updates.get(dataset[i].id);
        if (u) dataset[i] = { ...dataset[i], ...u };
      }
      await writeDataset(dataset);
    });
  },

  async getDataset(): Promise<TrainingExample[]> {
    return readDataset();
  },
};
