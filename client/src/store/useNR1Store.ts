import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AgentName,
  AgentResult,
  AgentStatus,
  Analogue,
  CarryTradeRisk,
  EventClassification,
  ForeignFlowDirection,
  ForeignFlowResult,
  HistoryEntry,
  KeyContradiction,
  NewsItem,
  NNWeightSource,
  SectorRotation,
  SignalResult,
  SynthesisStatus,
  VolatilityRegime,
} from '../types';
import { AGENT_NAMES } from '../types';

// Timeframe → minutes map (1W=10080, 1M=43200)
const TF_MINUTES: Record<string, number> = { '1W': 10080, '1M': 43200 };
import { runAgentSwarm, synthesizeAgents } from '../lib/agentSwarm';
import { classifyEvent } from '../lib/eventClassifier';
import { runPatternAgent } from '../lib/patternAgent';
import { runOpusEscalation } from '../lib/opusEscalation';
import {
  runNN,
  getNNWeightSource,
  checkAndRetrain,
  inferEventType,
  getCurrentSession,
  getDayOfWeek,
  ASSET_ENCODING,
} from '../lib/nnLayer';
import { aggregateSignal } from '../lib/signalAggregator';

interface NR1State {
  eventText: string;
  asset: string;
  timeframe: string;
  volatilityRegime: VolatilityRegime;

  vixValue: number | null;
  vixTimestamp: string | null;
  vixStale: boolean;

  agentResults: Record<AgentName, AgentResult | null>;
  agentStatus: Record<AgentName, AgentStatus>;
  didEscalate: boolean;
  escalationInProgress: boolean;

  patternResults: Analogue[] | null;
  patternStatus: 'idle' | 'loading' | 'complete' | 'error';

  nnOutput: number[] | null;
  nnWeightSource: NNWeightSource;
  nnTrainedExamples: number;

  synthesisSummary: string | null;
  synthesisThemes: string[];
  synthesisStatus: SynthesisStatus;
  keyContradiction: KeyContradiction | null;

  eventClassification: EventClassification | null;
  classificationStatus: 'idle' | 'loading' | 'complete';

  finalSignal: SignalResult | null;
  analysisComplete: boolean;

  sessionHistory: HistoryEntry[];
  activeHistoryId: string | null;

  newsItems: NewsItem[];
  newsLastUpdated: string | null;

  isRunning: boolean;

  // ── Japan Intel ────────────────────────────────────────────────────────────
  isJapanAsset: boolean;
  carryTradeRisk: CarryTradeRisk;
  usdJpyPrice: number | null;
  jgbYield: number | null;
  jgbChange: number | null;
  sectorRotation: SectorRotation;
  shuntoFlag: boolean;
  tseReformFlag: boolean;
  bojFlag: boolean;
  foreignFlowDirection: ForeignFlowDirection | null;
  foreignFlowConviction: number | null;
  foreignFlowReasoning: string | null;
  foreignFlowKeyDriver: string | null;

  setEventText: (text: string) => void;
  setAsset: (asset: string) => void;
  setTimeframe: (tf: string) => void;
  setVolatilityRegime: (vr: VolatilityRegime) => void;
  setVix: (value: number | null, timestamp: string | null, stale: boolean) => void;
  setNNStatus: (source: NNWeightSource, examples: number) => void;
  fetchNews: () => Promise<void>;
  runAnalysis: () => Promise<void>;
  clearRun: () => void;
  loadHistoryEntry: (id: string) => void;
  // Japan Intel actions
  setCarryTradeRisk: (risk: CarryTradeRisk) => void;
  setUsdJpyPrice: (price: number | null) => void;
  setJgbData: (data: { yield: number | null; change: number | null }) => void;
  setSectorRotation: (rotation: SectorRotation) => void;
  setStructuralFlags: (eventText: string) => void;
  setForeignFlowResult: (result: ForeignFlowResult | null) => void;
  fetchJgb: () => Promise<void>;
}

const initialAgentResults = Object.fromEntries(
  AGENT_NAMES.map((n) => [n, null])
) as Record<AgentName, AgentResult | null>;

const initialAgentStatus = Object.fromEntries(
  AGENT_NAMES.map((n) => [n, 'pending' as AgentStatus])
) as Record<AgentName, AgentStatus>;

export const useNR1Store = create<NR1State>()(
  persist(
    (set, get) => ({
      eventText: '',
      asset: 'NQ',
      timeframe: '1W',
      volatilityRegime: 'medium',

      vixValue: null,
      vixTimestamp: null,
      vixStale: false,

      agentResults: { ...initialAgentResults },
      agentStatus: { ...initialAgentStatus },
      didEscalate: false,
      escalationInProgress: false,

      patternResults: null,
      patternStatus: 'idle',

      nnOutput: null,
      nnWeightSource: 'synthetic',
      nnTrainedExamples: 0,

      synthesisSummary: null,
      synthesisThemes: [],
      synthesisStatus: 'idle',
      keyContradiction: null,

      eventClassification: null,
      classificationStatus: 'idle',

      finalSignal: null,
      analysisComplete: false,

      sessionHistory: [],
      activeHistoryId: null,

      newsItems: [],
      newsLastUpdated: null,

      isRunning: false,

      // ── Japan Intel initial state ─────────────────────────────────────────
      isJapanAsset: false,
      carryTradeRisk: 'unknown' as CarryTradeRisk,
      usdJpyPrice: null,
      jgbYield: null,
      jgbChange: null,
      sectorRotation: 'accumulating' as SectorRotation,
      shuntoFlag: false,
      tseReformFlag: false,
      bojFlag: false,
      foreignFlowDirection: null,
      foreignFlowConviction: null,
      foreignFlowReasoning: null,
      foreignFlowKeyDriver: null,

      setEventText: (text) => set({ eventText: text }),
      setAsset: (asset) => set({
        asset,
        isJapanAsset: asset === 'NKY' || asset === 'TOPIX' || asset === 'EWJ',
      }),
      setTimeframe: (tf) => set({ timeframe: tf }),
      setVolatilityRegime: (vr) => set({ volatilityRegime: vr }),
      setVix: (value, timestamp, stale) =>
        set({ vixValue: value, vixTimestamp: timestamp, vixStale: stale }),
      setNNStatus: (source, examples) =>
        set({ nnWeightSource: source, nnTrainedExamples: examples }),

      fetchNews: async () => {
        try {
          const res = await fetch('/api/news');
          if (!res.ok) return;
          const data = await res.json() as NewsItem[];
          set({ newsItems: data, newsLastUpdated: new Date().toISOString() });
        } catch { /* silent */ }
      },

      // ── Japan Intel actions ───────────────────────────────────────────────
      setCarryTradeRisk: (risk) => set({ carryTradeRisk: risk }),
      setUsdJpyPrice: (price) => set({ usdJpyPrice: price }),
      setJgbData: (data) => set({ jgbYield: data.yield, jgbChange: data.change }),
      setSectorRotation: (rotation) => set({ sectorRotation: rotation }),

      setStructuralFlags: (text) => {
        const t = text.toLowerCase();
        const shuntoFlag = [
          'shunto', 'wage negotiation', 'wage growth', 'spring wages',
          'labor negotiation', 'pay rise japan', 'minimum wage japan',
          'rengo', 'spring offensive',
        ].some((kw) => t.includes(kw));
        const tseReformFlag = [
          'tse reform', 'tokyo stock exchange reform', 'buyback japan',
          'p/b ratio', 'corporate governance japan', 'shareholder return japan',
          'cross-shareholding', 'activist investor japan', 'takeover japan',
          'jpx', 'stewardship code', 'price to book',
        ].some((kw) => t.includes(kw));
        const bojFlag = [
          'bank of japan', 'boj', 'yield curve control', 'ycc', 'ueda',
          'negative interest rate', 'rate normalization', 'boj hike', 'boj cut',
        ].some((kw) => t.includes(kw));
        set({ shuntoFlag, tseReformFlag, bojFlag });
      },

      setForeignFlowResult: (result) =>
        result
          ? set({
              foreignFlowDirection: result.direction,
              foreignFlowConviction: result.conviction,
              foreignFlowReasoning: result.reasoning,
              foreignFlowKeyDriver: result.keyDriver,
            })
          : set({
              foreignFlowDirection: null,
              foreignFlowConviction: null,
              foreignFlowReasoning: null,
              foreignFlowKeyDriver: null,
            }),

      fetchJgb: async () => {
        try {
          const res = await fetch('/api/jgb');
          if (!res.ok) return;
          const data = await res.json() as { yield: number | null; change: number | null; error?: boolean };
          if (!data.error) set({ jgbYield: data.yield, jgbChange: data.change });
        } catch { /* silent */ }
      },

      runAnalysis: async () => {
        const { eventText, asset, timeframe, volatilityRegime } = get();
        if (!eventText.trim()) return;

        set({
          isRunning: true,
          analysisComplete: false,
          finalSignal: null,
          nnOutput: null,
          patternResults: null,
          patternStatus: 'loading',
          didEscalate: false,
          escalationInProgress: false,
          synthesisSummary: null,
          synthesisThemes: [],
          synthesisStatus: 'loading',
          keyContradiction: null,
          eventClassification: null,
          classificationStatus: 'loading',
          agentResults: { ...initialAgentResults },
          agentStatus: Object.fromEntries(
            AGENT_NAMES.map((n) => [n, 'loading' as AgentStatus])
          ) as Record<AgentName, AgentStatus>,
        });

        // Step 1: Classify event first — agents receive this context
        let classification: EventClassification | null = null;
        try {
          classification = await classifyEvent(eventText, asset);
          set({ eventClassification: classification, classificationStatus: 'complete' });
        } catch {
          set({ classificationStatus: 'complete' });
        }

        // Step 2: Fire pattern + NN in parallel with swarm
        const patternPromise = runPatternAgent(eventText, asset, timeframe).then(
          (results) => { set({ patternResults: results, patternStatus: 'complete' }); return results; },
          () => { set({ patternStatus: 'error' }); return null; }
        );

        const nnPromise = runNN(eventText, asset, volatilityRegime).then((output) => {
          set({ nnOutput: output, nnWeightSource: getNNWeightSource() });
          return output;
        });

        // Step 3: Agent swarm with classification context
        await runAgentSwarm(
          eventText, asset, timeframe, volatilityRegime,
          (agentName, status, result) => {
            set((state) => ({
              agentStatus: { ...state.agentStatus, [agentName]: status },
              agentResults: result
                ? { ...state.agentResults, [agentName]: result }
                : state.agentResults,
            }));
          },
          classification
        );

        const currentResults = get().agentResults;
        const completedResults = Object.values(currentResults).filter(
          (r): r is AgentResult => r !== null
        );

        let finalResults = currentResults;
        let didEscalate = false;

        // Step 4: Opus escalation if split
        if (completedResults.length >= 7) {
          const dirs = completedResults.map((r) => r.direction);
          const bullish = dirs.filter((d) => d === 'bullish').length;
          const bearish = dirs.filter((d) => d === 'bearish').length;
          const majorityCount = Math.max(bullish, bearish);
          const total = completedResults.length;

          if (majorityCount < Math.ceil((total * 2) / 3)) {
            set({ escalationInProgress: true });
            try {
              const opusResults = await runOpusEscalation(
                eventText, asset, timeframe, volatilityRegime,
                (agentName, status, result) => {
                  set((state) => ({
                    agentStatus: { ...state.agentStatus, [agentName]: status },
                    agentResults: result
                      ? { ...state.agentResults, [agentName]: result }
                      : state.agentResults,
                  }));
                }
              );
              finalResults = opusResults;
              didEscalate = true;
            } catch { /* use original */ }
            set({ escalationInProgress: false, didEscalate });
          }
        }

        // Step 5: Synthesis with contradiction detection
        const synthesisPromise = synthesizeAgents(eventText, asset, timeframe, finalResults).then(
          ({ summary, themes, key_contradiction }) => {
            set({
              synthesisSummary: summary,
              synthesisThemes: themes,
              keyContradiction: key_contradiction,
              synthesisStatus: 'complete',
            });
          },
          () => { set({ synthesisStatus: 'error' }); }
        );

        await Promise.all([patternPromise, nnPromise, synthesisPromise]);

        // Step 6: Weighted signal aggregation
        const nnOutput = get().nnOutput;
        const currentNNWeightSource = getNNWeightSource();
        const currentClassification = get().eventClassification;

        const allResults = Object.entries(finalResults)
          .filter(([, r]) => r !== null)
          .map(([key, r]) => ({ ...r!, agentKey: key }));

        if (allResults.length > 0) {
          const signal = aggregateSignal(
            allResults,
            nnOutput,
            didEscalate,
            currentNNWeightSource,
            currentClassification,
            timeframe
          );
          set({ finalSignal: signal, analysisComplete: true });
        }

        const state = get();

        // Step 7: Log run to outcome logger
        let ibRunId: string | undefined;
        let priceAtRun: number | null = null;
        try {
          const agentDirections = Object.fromEntries(
            Object.entries(state.agentResults)
              .filter(([, r]) => r !== null)
              .map(([k, r]) => [k, r!.direction])
          );
          const runRes = await fetch('/api/run/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asset,
              timeframe,
              timeframe_minutes: TF_MINUTES[timeframe] ?? 10080,
              volatility_regime: volatilityRegime,
              event_text: eventText,
              event_type_encoded: inferEventType(eventText),
              asset_encoded: ASSET_ENCODING[asset] ?? 0,
              session: getCurrentSession(),
              day_of_week: getDayOfWeek(),
              signal_direction: state.finalSignal?.direction ?? 'neutral',
              signal_confidence: state.finalSignal?.confidence ?? 0,
              nn_predicted_bins: state.nnOutput ?? [],
              agent_directions: agentDirections,
            }),
          });
          if (runRes.ok) {
            const runData = await runRes.json() as { id: string; price_at_run: number | null };
            ibRunId = runData.id;
            priceAtRun = runData.price_at_run;
          }
        } catch { /* silent */ }

        const historyEntry: HistoryEntry = {
          id: crypto.randomUUID(),
          eventText,
          asset,
          timeframe,
          volatilityRegime,
          agentResults: state.agentResults,
          patternResults: state.patternResults,
          nnOutput: state.nnOutput,
          finalSignal: state.finalSignal,
          timestamp: new Date().toISOString(),
          ibRunId,
          priceAtRun,
        };

        set((s) => ({
          sessionHistory: [historyEntry, ...s.sessionHistory],
          activeHistoryId: historyEntry.id,
          isRunning: false,
        }));

        checkAndRetrain((source, examples) => {
          set({ nnWeightSource: source, nnTrainedExamples: examples });
        }).catch(() => {});
      },

      clearRun: () =>
        set({
          eventText: '',
          agentResults: { ...initialAgentResults },
          agentStatus: { ...initialAgentStatus },
          patternResults: null,
          patternStatus: 'idle',
          nnOutput: null,
          synthesisSummary: null,
          synthesisThemes: [],
          synthesisStatus: 'idle',
          keyContradiction: null,
          eventClassification: null,
          classificationStatus: 'idle',
          finalSignal: null,
          analysisComplete: false,
          didEscalate: false,
          escalationInProgress: false,
          activeHistoryId: null,
          isRunning: false,
        }),

      loadHistoryEntry: (id) => {
        const entry = get().sessionHistory.find((e) => e.id === id);
        if (!entry) return;
        set({
          eventText: entry.eventText,
          asset: entry.asset,
          timeframe: entry.timeframe,
          volatilityRegime: entry.volatilityRegime,
          agentResults: entry.agentResults,
          agentStatus: Object.fromEntries(
            AGENT_NAMES.map((n) => [n, entry.agentResults[n] ? 'complete' : 'error'])
          ) as Record<AgentName, AgentStatus>,
          patternResults: entry.patternResults,
          patternStatus: entry.patternResults ? 'complete' : 'idle',
          nnOutput: entry.nnOutput,
          finalSignal: entry.finalSignal,
          analysisComplete: !!entry.finalSignal,
          didEscalate: entry.finalSignal?.didEscalate ?? false,
          escalationInProgress: false,
          activeHistoryId: id,
          isRunning: false,
        });
      },
    }),
    {
      name: 'nr1-session-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ sessionHistory: state.sessionHistory }),
    }
  )
);
