import * as tf from '@tensorflow/tfjs';
import type { NNWeightSource, VolatilityRegime } from '../types';

export const ASSET_ENCODING: Record<string, number> = {
  'NQ': 0, 'ES': 1, 'WTI': 2, 'NKY': 3, 'TOPIX': 4, 'EWJ': 5,
};

const EVENT_KEYWORDS: [string[], number][] = [
  [['rate', 'interest', 'hike', 'cut', 'fed funds', 'basis points'], 0],
  [['war', 'invasion', 'sanctions', 'conflict', 'military', 'geopolit'], 1],
  [['gdp', 'cpi', 'nfp', 'payroll', 'unemployment', 'inflation', 'pmi', 'retail sales'], 2],
  [['powell', 'lagarde', 'boj', 'ecb', 'fed chair', 'central bank', 'speech', 'testimony'], 3],
  [['crash', 'default', 'bankruptcy', 'contagion', 'black swan', 'collapse', 'crisis'], 4],
];

const VOLATILITY_ENCODING: Record<VolatilityRegime, number> = {
  low: 0, medium: 1, high: 2,
};

export const TIMEFRAME_MINUTES: Record<string, number> = {
  '5m': 5, '15m': 15, '1h': 60, '4h': 240,
};

export function inferEventType(text: string): number {
  const lower = text.toLowerCase();
  for (const [keywords, code] of EVENT_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return code;
  }
  return 5;
}

export function getCurrentSession(): number {
  const hour = new Date().getUTCHours();
  if (hour < 8) return 0;
  if (hour < 16) return 1;
  return 2;
}

export function getDayOfWeek(): number {
  const day = new Date().getDay();
  return Math.min(day === 0 ? 4 : day - 1, 4);
}

const LS_WEIGHTS_KEY  = 'nr1_nn_weights';
const LS_COUNT_KEY    = 'nr1_nn_trained_count';

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

async function initModel(): Promise<void> {
  model = buildModel();

  const saved = localStorage.getItem(LS_WEIGHTS_KEY);
  if (saved) {
    try {
      const weightData: number[][] = JSON.parse(saved) as number[][];
      const currentWeights = model.getWeights();
      const tensors = weightData.map((arr, i) => tf.tensor(arr, currentWeights[i].shape));
      currentWeights.forEach((w) => w.dispose());
      model.setWeights(tensors);
      tensors.forEach((t) => t.dispose());
      nnWeightSource = 'trained';
      nnTrainedExamples = parseInt(localStorage.getItem(LS_COUNT_KEY) ?? '0', 10);
      console.log(`NR-1: loaded trained weights from localStorage (${nnTrainedExamples} examples)`);
    } catch (e) {
      console.warn('NR-1: failed to load saved weights, using synthetic:', e);
      nnWeightSource = 'synthetic';
    }
  } else {
    console.log('NR-1: using synthetic weights — no trained weights in localStorage');
  }
}

export async function runNN(
  eventText: string,
  asset: string,
  volatilityRegime: VolatilityRegime
): Promise<number[]> {
  if (!model) await initModel();

  const assetCode = ASSET_ENCODING[asset] ?? 0;
  const eventType = inferEventType(eventText);
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
  actual_bin: number | null;
  outcome_captured: boolean;
}

export async function checkAndRetrain(
  onRetrained?: (source: NNWeightSource, count: number) => void
): Promise<void> {
  console.log('NR-1: checkAndRetrain() called');
  try {
    const statsRes = await fetch('/api/dataset/stats');
    if (!statsRes.ok) {
      console.warn('NR-1: /api/dataset/stats returned', statsRes.status);
      return;
    }
    const stats = await statsRes.json() as { total: number; withOutcomes: number; readyToTrain: boolean };
    console.log('NR-1: dataset stats:', JSON.stringify(stats));

    if (!stats.readyToTrain) {
      console.log(`NR-1: not ready to train (withOutcomes=${stats.withOutcomes}, need >= 50)`);
      return;
    }

    const dataRes = await fetch('/api/dataset');
    if (!dataRes.ok) {
      console.warn('NR-1: /api/dataset returned', dataRes.status);
      return;
    }
    const dataset = await dataRes.json() as TrainingRow[];

    // Include any example with a resolved actual_bin — covers GDELT historical
    // data where outcome_captured may be false but bin is set.
    const labeled = dataset.filter(
      (e) => e.actual_bin !== null && e.actual_bin !== undefined
    );
    console.log(`NR-1: starting retrain on ${labeled.length} examples`);

    if (labeled.length < 50) {
      console.log('NR-1: fewer than 50 labeled examples after filter, skipping');
      return;
    }

    if (!model) await initModel();

    const VOLATILITY_ENC: Record<string, number> = { low: 0, medium: 1, high: 2 };

    const xs = labeled.map((e) => [
      e.asset_encoded       ?? 0,
      e.event_type_encoded  ?? 6,
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

    const xTensor = tf.tensor2d(xs);
    const yTensor = tf.tensor2d(ys);

    await model!.fit(xTensor, yTensor, {
      epochs: 50,
      batchSize: 32,
      shuffle: true,
      verbose: 0,
    });

    xTensor.dispose();
    yTensor.dispose();

    // Persist weights + count to localStorage
    const weights = model!.getWeights();
    const weightArrays = await Promise.all(weights.map((w) => w.data().then((d) => Array.from(d))));
    weights.forEach((w) => w.dispose());
    localStorage.setItem(LS_WEIGHTS_KEY, JSON.stringify(weightArrays));
    localStorage.setItem(LS_COUNT_KEY, String(labeled.length));

    nnWeightSource = 'trained';
    nnTrainedExamples = labeled.length;

    console.log(`NR-1: retrain complete, weights saved (${labeled.length} examples)`);
    onRetrained?.('trained', labeled.length);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('NR-1: retrain error:', msg);
  }
}
