import * as tf from '@tensorflow/tfjs';
import type { EventClassification, EventType, NNWeightSource, VolatilityRegime } from '../types';

// ─── Feature encoding ─────────────────────────────────────────────────────────
// These must match pipeline/build_dataset.py exactly, or the network is queried
// with different meanings than it was trained on.

export const ASSET_ENCODING: Record<string, number> = {
  'NQ': 0, 'ES': 1, 'WTI': 2, 'NKY': 3, 'TOPIX': 4, 'EWJ': 5,
};

// Same taxonomy as the LLM classifier and the pipeline's EVENT_TYPE_ENCODING.
export const EVENT_TYPE_ENCODING: Record<EventType, number> = {
  geopolitical: 0, central_bank: 1, data_release: 2, corporate: 3,
  commodity_supply: 4, risk_off: 5, other: 6,
};

// Keyword fallback for when the classifier call fails. Whole-word matches only,
// so "software" is not "war" and "corporate" is not "rate".
const EVENT_KEYWORDS: [string[], EventType][] = [
  [['fed', 'fomc', 'federal reserve', 'ecb', 'boj', 'bank of japan', 'central bank', 'rate hike', 'rate cut',
    'interest rate', 'interest rates', 'powell', 'lagarde', 'ueda', 'monetary policy', 'basis points'], 'central_bank'],
  [['gdp', 'cpi', 'ppi', 'nfp', 'payrolls', 'jobs report', 'unemployment', 'inflation', 'pmi', 'retail sales',
    'tankan'], 'data_release'],
  [['war', 'invasion', 'sanctions', 'conflict', 'military', 'missile', 'missiles', 'troops', 'tariff', 'tariffs',
    'trade war', 'geopolitical', 'embargo', 'blockade'], 'geopolitical'],
  [['opec', 'oil supply', 'crude inventory', 'crude inventories', 'production cut', 'refinery', 'pipeline',
    'energy crisis'], 'commodity_supply'],
  [['crash', 'default', 'bankruptcy', 'contagion', 'black swan', 'collapse', 'crisis', 'bank run',
    'recession fears', 'selloff', 'sell-off'], 'risk_off'],
  [['earnings', 'guidance', 'revenue', 'buyback', 'merger', 'acquisition', 'ipo', 'ceo', 'profit'], 'corporate'],
];

const EVENT_PATTERNS: [RegExp, EventType][] = EVENT_KEYWORDS.map(([keywords, type]) => [
  new RegExp(`\\b(?:${keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i'),
  type,
]);

export function inferEventType(text: string): EventType {
  for (const [pattern, type] of EVENT_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return 'other';
}

export function encodeEventType(classification: EventClassification | null, text: string): number {
  const type = classification?.event_type && classification.event_type in EVENT_TYPE_ENCODING
    ? classification.event_type
    : inferEventType(text);
  return EVENT_TYPE_ENCODING[type];
}

const VOLATILITY_ENCODING: Record<VolatilityRegime, number> = {
  low: 0, medium: 1, high: 2,
};

export function getCurrentSession(): number {
  const hour = new Date().getUTCHours();
  if (hour < 8) return 0;
  if (hour < 16) return 1;
  return 2;
}

// Monday=0 … Sunday=6 in UTC, matching Python's datetime.weekday() on UTC timestamps.
export function getDayOfWeek(): number {
  return (new Date().getUTCDay() + 6) % 7;
}

// ─── Model ────────────────────────────────────────────────────────────────────

// v2: weights trained before the encoding fix are incompatible and are discarded.
const LS_WEIGHTS_KEY  = 'nr1_nn_weights_v2';
const LS_COUNT_KEY    = 'nr1_nn_trained_count_v2';
const LEGACY_LS_KEYS  = ['nr1_nn_weights', 'nr1_nn_trained_count'];

// Retrain only once this many new labeled examples have arrived since the last fit.
const RETRAIN_STEP = 50;

let model: tf.LayersModel | null = null;
let nnWeightSource: NNWeightSource = 'synthetic';
let nnTrainedExamples = 0;

function buildModel(): tf.LayersModel {
  const input = tf.input({ shape: [5] });
  const dense1 = tf.layers.dense({ units: 64, activation: 'relu', kernelInitializer: 'glorotUniform' }).apply(input);
  const dense2 = tf.layers.dense({ units: 32, activation: 'relu', kernelInitializer: 'glorotUniform' }).apply(dense1);
  const output = tf.layers.dense({ units: 7, activation: 'softmax', kernelInitializer: 'glorotUniform' }).apply(dense2);
  const m = tf.model({ inputs: input, outputs: output as tf.SymbolicTensor });
  m.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy' });
  return m;
}

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

async function initModel(): Promise<void> {
  model = buildModel();
  try { LEGACY_LS_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }

  const saved = storageGet(LS_WEIGHTS_KEY);
  if (saved) {
    try {
      const weightData: number[][] = JSON.parse(saved) as number[][];
      // getWeights() returns the model's live variables — read shapes only, never dispose them.
      const shapes = model.getWeights().map((w) => w.shape);
      const tensors = weightData.map((arr, i) => tf.tensor(arr, shapes[i]));
      model.setWeights(tensors);
      tensors.forEach((t) => t.dispose());
      nnWeightSource = 'trained';
      nnTrainedExamples = parseInt(storageGet(LS_COUNT_KEY) ?? '0', 10);
      console.log(`NR-1: loaded trained weights from localStorage (${nnTrainedExamples} examples)`);
    } catch (e) {
      console.warn('NR-1: failed to load saved weights, using synthetic:', e);
      model = buildModel();
      nnWeightSource = 'synthetic';
    }
  } else {
    console.log('NR-1: using synthetic weights — no trained weights in localStorage');
  }
}

export async function runNN(
  eventText: string,
  asset: string,
  volatilityRegime: VolatilityRegime,
  classification: EventClassification | null
): Promise<number[]> {
  if (!model) await initModel();

  const assetCode = ASSET_ENCODING[asset] ?? 0;
  const eventType = encodeEventType(classification, eventText);
  const session = getCurrentSession();
  const dayOfWeek = getDayOfWeek();
  const volCode = VOLATILITY_ENCODING[volatilityRegime];

  const inputTensor = tf.tensor2d([[assetCode, eventType, session, dayOfWeek, volCode]]);
  const prediction = model!.predict(inputTensor) as tf.Tensor;
  const result = await prediction.data();

  inputTensor.dispose();
  prediction.dispose();

  return Array.from(result);
}

export function getNNWeightSource(): NNWeightSource {
  return nnWeightSource;
}

export function getNNTrainedExamples(): number {
  return nnTrainedExamples;
}

interface TrainingRow {
  asset_encoded: number;
  event_type_encoded: number;
  session: number;
  day_of_week: number;
  volatility_regime: string;
  timeframe?: string;
  actual_bin: number | null;
  outcome_captured: boolean;
}

export async function checkAndRetrain(
  onRetrained?: (source: NNWeightSource, count: number) => void
): Promise<void> {
  try {
    const statsRes = await fetch('/api/dataset/stats');
    if (!statsRes.ok) {
      console.warn('NR-1: /api/dataset/stats returned', statsRes.status);
      return;
    }
    const stats = await statsRes.json() as { total: number; withOutcomes: number; readyToTrain: boolean };
    if (!stats.readyToTrain) return;

    if (!model) await initModel();
    if (nnWeightSource === 'trained' && stats.withOutcomes < nnTrainedExamples + RETRAIN_STEP) return;

    const dataRes = await fetch('/api/dataset');
    if (!dataRes.ok) {
      console.warn('NR-1: /api/dataset returned', dataRes.status);
      return;
    }
    const dataset = await dataRes.json() as TrainingRow[];

    // Include any example with a resolved actual_bin — covers GDELT historical
    // data where outcome_captured may be false but bin is set. The network has no
    // timeframe input and the history is all 1W, so 1M outcomes are kept out.
    const labeled = dataset.filter(
      (e) => e.actual_bin !== null && e.actual_bin !== undefined && (e.timeframe ?? '1W') === '1W'
    );

    if (labeled.length < 50) {
      console.log('NR-1: fewer than 50 labeled 1W examples, skipping retrain');
      return;
    }
    if (nnWeightSource === 'trained' && labeled.length < nnTrainedExamples + RETRAIN_STEP) return;

    console.log(`NR-1: starting retrain on ${labeled.length} examples`);

    const VOLATILITY_ENC: Record<string, number> = { low: 0, medium: 1, high: 2 };

    const xs = labeled.map((e) => [
      e.asset_encoded       ?? 0,
      e.event_type_encoded  ?? EVENT_TYPE_ENCODING.other,
      e.session             ?? 1,
      e.day_of_week         ?? 0,
      VOLATILITY_ENC[e.volatility_regime] ?? 1,
    ]);

    const ys = labeled.map((e) => {
      const oneHot = new Array(7).fill(0) as number[];
      const bin = Math.max(0, Math.min(6, e.actual_bin!));
      oneHot[bin] = 1;
      return oneHot;
    });

    // Fit a fresh model each time instead of stacking more epochs on old weights.
    const fresh = buildModel();
    const xTensor = tf.tensor2d(xs);
    const yTensor = tf.tensor2d(ys);

    await fresh.fit(xTensor, yTensor, {
      epochs: 50,
      batchSize: 32,
      shuffle: true,
      verbose: 0,
    });

    xTensor.dispose();
    yTensor.dispose();

    // Persist weights + count to localStorage. getWeights() returns the live
    // variables, so read them without disposing.
    const weightArrays = await Promise.all(fresh.getWeights().map((w) => w.data().then((d) => Array.from(d))));
    try {
      localStorage.setItem(LS_WEIGHTS_KEY, JSON.stringify(weightArrays));
      localStorage.setItem(LS_COUNT_KEY, String(labeled.length));
    } catch { /* storage full or unavailable — keep weights in memory */ }

    model?.dispose();
    model = fresh;
    nnWeightSource = 'trained';
    nnTrainedExamples = labeled.length;

    console.log(`NR-1: retrain complete, weights saved (${labeled.length} examples)`);
    onRetrained?.('trained', labeled.length);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('NR-1: retrain error:', msg);
  }
}
