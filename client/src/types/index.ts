export type Direction = 'bullish' | 'bearish' | 'neutral';

export type AgentName =
  | 'momentum_trader'
  | 'macro_fund'
  | 'retail_crowd'
  | 'market_maker'
  | 'risk_officer'
  | 'central_bank_watcher'
  | 'options_trader'
  | 'quant_fund'
  | 'bond_market';

export type AgentStatus = 'pending' | 'loading' | 'complete' | 'error';

export type VolatilityRegime = 'low' | 'medium' | 'high';

export interface AgentResult {
  direction: Direction;
  conviction: number;
  timeframe: string;
  reasoning: string;
  key_factors: string[];
}

export interface Analogue {
  date: string;
  event: string;
  asset: string;
  outcome: Direction;
  magnitude: string;
  notes: string;
}

export interface SignalResult {
  direction: Direction;
  confidence: number;
  conflictDetected: boolean;
  didEscalate: boolean;
}

export interface HistoryEntry {
  id: string;
  eventText: string;
  asset: string;
  timeframe: string;
  volatilityRegime: VolatilityRegime;
  agentResults: Record<AgentName, AgentResult | null>;
  patternResults: Analogue[] | null;
  nnOutput: number[] | null;
  finalSignal: SignalResult | null;
  timestamp: string;
  ibRunId?: string;
  priceAtRun?: number | null;
}

export const AGENT_NAMES: AgentName[] = [
  'momentum_trader',
  'macro_fund',
  'retail_crowd',
  'market_maker',
  'risk_officer',
  'central_bank_watcher',
  'options_trader',
  'quant_fund',
  'bond_market',
];

export const AGENT_DISPLAY_NAMES: Record<AgentName, string> = {
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

export const ASSETS = {
  Futures: ['NQ', 'ES', 'WTI'],
  Japan:   ['NKY', 'TOPIX', 'EWJ'],
} as const;

export type Asset = 'NQ' | 'ES' | 'WTI' | 'NKY' | 'TOPIX' | 'EWJ';

export const ALL_ASSETS = ['NQ', 'ES', 'WTI', 'NKY', 'TOPIX', 'EWJ'] as const;

export const TIMEFRAMES = ['1W', '1M'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export type SynthesisStatus = 'idle' | 'loading' | 'complete' | 'error';

export type NNWeightSource = 'synthetic' | 'trained';

export type EventType =
  | 'geopolitical'
  | 'central_bank'
  | 'data_release'
  | 'corporate'
  | 'commodity_supply'
  | 'risk_off'
  | 'other';

export type EventSeverity = 'low' | 'medium' | 'high' | 'extreme';
export type AssetClass = 'forex' | 'commodity' | 'equity' | 'rates';
export type DirectionalClarity = 'clear' | 'ambiguous' | 'contradictory';

export interface EventClassification {
  event_type: EventType;
  severity: EventSeverity;
  primary_asset_class: AssetClass;
  directional_clarity: DirectionalClarity;
}

export interface KeyContradiction {
  agent1: string;
  agent2: string;
  reason: string;
}

export interface DatasetStats {
  total: number;
  withOutcomes: number;
  readyToTrain: boolean;
}

export interface NewsItem {
  id: string;
  title: string;
  source: 'Google' | 'FT' | 'Investing' | 'NHK' | 'Nikkei' | 'JapanTimes' | 'ReutersJP';
  pubDate: string;
  link: string;
  summary: string;
}

// ─── Japan Intel types ────────────────────────────────────────────────────────

export type CarryTradeRisk = 'low' | 'elevated' | 'critical' | 'unknown';
export type SectorRotation = 'exporters' | 'domestics' | 'neutral' | 'accumulating';
export type ForeignFlowDirection = 'inflow' | 'outflow' | 'neutral';

export interface ForeignFlowResult {
  direction: ForeignFlowDirection;
  conviction: number;
  reasoning: string;
  keyDriver: string;
}
