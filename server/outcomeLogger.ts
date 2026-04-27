import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { ibGateway } from './ibGateway.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'training_dataset.json');

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
}

export interface DatasetStats {
  total: number;
  withOutcomes: number;
  readyToTrain: boolean;
}

// Simple write mutex — queues writes so the JSON file never corrupts
let writeLock: Promise<void> = Promise.resolve();

function assignBin(movePct: number): number {
  if (movePct < -2.5) return 0;
  if (movePct < -1.5) return 1;
  if (movePct < -0.5) return 2;
  if (movePct <=  0.5) return 3;
  if (movePct <=  1.5) return 4;
  if (movePct <=  2.5) return 5;
  return 6;
}

async function readDataset(): Promise<TrainingExample[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(raw) as TrainingExample[];
  } catch {
    return [];
  }
}

async function writeDataset(dataset: TrainingExample[]): Promise<void> {
  await fs.writeFile(DATA_FILE, JSON.stringify(dataset, null, 2), 'utf-8');
}

function queueWrite(fn: () => Promise<void>): void {
  writeLock = writeLock.then(fn).catch((err) => {
    console.error('[OutcomeLogger] Write error:', err);
  });
}

export const outcomeLogger = {
  logRun(
    example: Omit<TrainingExample, 'id' | 'price_at_outcome' | 'actual_move_pct' | 'actual_bin' | 'outcome_captured' | 'outcome_timestamp'>
  ): string {
    const id = randomUUID();
    const full: TrainingExample = {
      ...example,
      id,
      price_at_outcome: null,
      actual_move_pct: null,
      actual_bin: null,
      outcome_captured: false,
      outcome_timestamp: null,
    };

    queueWrite(async () => {
      const dataset = await readDataset();
      dataset.push(full);
      await writeDataset(dataset);
    });

    return id;
  },

  scheduleOutcomeCapture(
    id: string,
    asset: string,
    timeframe_minutes: number,
    price_at_run: number
  ): void {
    const delayMs = timeframe_minutes * 60 * 1000;

    setTimeout(() => {
      ibGateway.getPrice(asset).then((priceData) => {
        if (priceData.mid === null) {
          console.log(`[OutcomeLogger] Could not capture outcome for ${id} — IB offline`);
          return;
        }

        const price_at_outcome = priceData.mid;
        const actual_move_pct = ((price_at_outcome - price_at_run) / price_at_run) * 100;
        const actual_bin = assignBin(actual_move_pct);

        queueWrite(async () => {
          const dataset = await readDataset();
          const idx = dataset.findIndex((e) => e.id === id);
          if (idx === -1) return;
          dataset[idx] = {
            ...dataset[idx],
            price_at_outcome,
            actual_move_pct,
            actual_bin,
            outcome_captured: true,
            outcome_timestamp: new Date().toISOString(),
          };
          await writeDataset(dataset);
          console.log(`[OutcomeLogger] Outcome captured for ${id}: ${actual_move_pct.toFixed(3)}% → bin ${actual_bin}`);
        });
      }).catch((err) => {
        console.error('[OutcomeLogger] Outcome capture error:', err);
      });
    }, delayMs);

    // 1W=10080m→7d, 1M=43200m→30d
    const delayLabel = timeframe_minutes >= 1440
      ? `${(timeframe_minutes / 1440).toFixed(0)}d`
      : `${timeframe_minutes}m`;
    console.log(`[OutcomeLogger] Outcome scheduled for ${id} in ${delayLabel}`);
  },

  async getDataset(): Promise<TrainingExample[]> {
    return readDataset();
  },

  async getStats(): Promise<DatasetStats> {
    const dataset = await readDataset();
    const withOutcomes = dataset.filter((e) => e.outcome_captured).length;
    const readyToTrain = withOutcomes >= 50 && withOutcomes % 50 === 0;
    return { total: dataset.length, withOutcomes, readyToTrain };
  },
};
