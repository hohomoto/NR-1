import type { AgentResult, Direction, EventClassification, NNWeightSource, SignalResult } from '../types';

// Agent display name → weight per event type
const AGENT_WEIGHTS: Record<string, Record<string, number>> = {
  geopolitical: {
    'Risk Officer': 2.0,
    'Macro Fund': 1.5,
    'Momentum Trader': 1.2,
    'Market Maker': 1.2,
    'Options Trader': 1.3,
    'Central Bank Watcher': 0.8,
    'Retail Crowd': 0.7,
    'Algorithmic/Quant Fund': 1.0,
    'Bond Market': 1.0,
  },
  central_bank: {
    'Central Bank Watcher': 2.0,
    'Bond Market': 1.8,
    'Macro Fund': 1.5,
    'Options Trader': 1.3,
    'Algorithmic/Quant Fund': 1.2,
    'Market Maker': 1.0,
    'Momentum Trader': 0.9,
    'Retail Crowd': 0.6,
    'Risk Officer': 1.0,
  },
  data_release: {
    'Algorithmic/Quant Fund': 1.8,
    'Momentum Trader': 1.5,
    'Central Bank Watcher': 1.5,
    'Bond Market': 1.4,
    'Market Maker': 1.3,
    'Macro Fund': 1.2,
    'Options Trader': 1.1,
    'Retail Crowd': 0.7,
    'Risk Officer': 0.8,
  },
  commodity_supply: {
    'Risk Officer': 1.8,
    'Macro Fund': 1.5,
    'Market Maker': 1.4,
    'Momentum Trader': 1.3,
    'Options Trader': 1.3,
    'Algorithmic/Quant Fund': 1.0,
    'Bond Market': 0.8,
    'Central Bank Watcher': 0.8,
    'Retail Crowd': 0.9,
  },
  risk_off: {
    'Risk Officer': 2.0,
    'Market Maker': 1.6,
    'Options Trader': 1.5,
    'Bond Market': 1.3,
    'Macro Fund': 1.2,
    'Algorithmic/Quant Fund': 1.1,
    'Momentum Trader': 1.0,
    'Central Bank Watcher': 0.9,
    'Retail Crowd': 0.6,
  },
  corporate: {
    'Momentum Trader': 1.8,
    'Retail Crowd': 1.5,
    'Options Trader': 1.4,
    'Market Maker': 1.3,
    'Algorithmic/Quant Fund': 1.2,
    'Risk Officer': 1.0,
    'Macro Fund': 0.9,
    'Bond Market': 0.7,
    'Central Bank Watcher': 0.6,
  },
  other: {},
};

// Additional weight multipliers when timeframe is 1W (swing trading horizon)
const WEEKLY_WEIGHTS: Record<string, number> = {
  'Macro Fund':              1.4,
  'Central Bank Watcher':   1.4,
  'Bond Market':             1.3,
  'Risk Officer':            1.2,
  'Options Trader':          0.9,
  'Algorithmic/Quant Fund':  0.8,
  'Momentum Trader':         0.6,
  'Market Maker':            0.7,
  'Retail Crowd':            0.4,
};

// Additional weight multipliers when timeframe is 1M (monthly / position horizon)
const MONTHLY_WEIGHTS: Record<string, number> = {
  'Macro Fund':              1.6,
  'Central Bank Watcher':   1.6,
  'Bond Market':             1.4,
  'Risk Officer':            1.3,
  'Options Trader':          0.8,
  'Algorithmic/Quant Fund':  0.6,
  'Momentum Trader':         0.5,
  'Market Maker':            0.5,
  'Retail Crowd':            0.3,
};

const DISPLAY_NAMES: Record<string, string> = {
  momentum_trader: 'Momentum Trader',
  macro_fund: 'Macro Fund',
  retail_crowd: 'Retail Crowd',
  market_maker: 'Market Maker',
  risk_officer: 'Risk Officer',
  central_bank_watcher: 'Central Bank Watcher',
  options_trader: 'Options Trader',
  quant_fund: 'Algorithmic/Quant Fund',
  bond_market: 'Bond Market',
};

function getWeight(
  agentKey: string,
  eventType: string | undefined,
  timeframe: string = '1W'
): number {
  const displayName = DISPLAY_NAMES[agentKey] ?? agentKey;
  let w = 1.0;
  if (eventType) {
    const matrix = AGENT_WEIGHTS[eventType];
    if (matrix) w = matrix[displayName] ?? 1.0;
  }
  if (timeframe === '1W') {
    w *= WEEKLY_WEIGHTS[displayName] ?? 1.0;
  } else if (timeframe === '1M') {
    w *= MONTHLY_WEIGHTS[displayName] ?? 1.0;
  }
  return w;
}

export interface WeightedAgentInfo {
  agentKey: string;
  weight: number;
}

export function getAgentWeights(
  eventType: string | undefined,
  timeframe: string = '1W'
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(DISPLAY_NAMES)) {
    out[key] = getWeight(key, eventType, timeframe);
  }
  return out;
}

export function aggregateSignal(
  results: Array<AgentResult & { agentKey?: string }>,
  nnOutput: number[] | null,
  didEscalate: boolean,
  nnWeightSource: NNWeightSource = 'synthetic',
  classification: EventClassification | null = null,
  timeframe: string = '1W'
): SignalResult {
  const eventType = classification?.event_type;
  const clarity = classification?.directional_clarity;

  // Weighted vote tallies
  const weightedCounts: Record<Direction, number> = { bullish: 0, bearish: 0, neutral: 0 };
  let totalWeight = 0;

  for (const r of results) {
    const w = getWeight(r.agentKey ?? '', eventType, timeframe);
    weightedCounts[r.direction] += w;
    totalWeight += w;
  }

  let direction: Direction = 'neutral';
  if (
    weightedCounts.bullish > weightedCounts.bearish &&
    weightedCounts.bullish > weightedCounts.neutral
  ) {
    direction = 'bullish';
  } else if (
    weightedCounts.bearish > weightedCounts.bullish &&
    weightedCounts.bearish > weightedCounts.neutral
  ) {
    direction = 'bearish';
  }

  const majorityResults = results.filter((r) => r.direction === direction);
  const majorityWeightSum = majorityResults.reduce(
    (sum, r) => sum + getWeight(r.agentKey ?? '', eventType, timeframe),
    0
  );
  const majorityWeightedConviction =
    majorityResults.length > 0
      ? majorityResults.reduce(
          (sum, r) => sum + r.conviction * getWeight(r.agentKey ?? '', eventType, timeframe),
          0
        ) / majorityWeightSum
      : 5;

  const nnPeakProb = nnOutput ? Math.max(...nnOutput) : 0.5;
  const majorityFraction = totalWeight > 0 ? weightedCounts[direction] / totalWeight : 0;
  const total = results.length;

  let confidence: number;
  if (nnWeightSource === 'trained') {
    confidence =
      majorityFraction * 40 +
      (majorityWeightedConviction / 10) * 30 +
      nnPeakProb * 30;
  } else {
    confidence =
      majorityFraction * 50 +
      (majorityWeightedConviction / 10) * 45 +
      nnPeakProb * 5;
  }

  // Directional clarity modifier
  if (clarity === 'clear') {
    confidence = Math.min(confidence * 1.15, 95);
  } else if (clarity === 'ambiguous') {
    confidence *= 0.90;
  } else if (clarity === 'contradictory') {
    confidence *= 0.75;
  }

  // Conflict: majority weighted fraction < 2/3
  const conflictDetected =
    totalWeight > 0
      ? weightedCounts[direction] / totalWeight < 2 / 3
      : Math.max(...Object.values(weightedCounts)) < Math.ceil((total * 2) / 3);

  return {
    direction,
    confidence: Math.round(Math.min(confidence, 100)),
    conflictDetected,
    didEscalate,
  };
}
