import type { AgentName, AgentResult, AgentStatus, EventClassification, KeyContradiction } from '../types';
import { AGENT_NAMES, AGENT_DISPLAY_NAMES } from '../types';
import { extractText, postAnalyze } from './api';

const SYSTEM_PROMPTS: Record<AgentName, (asset: string, timeframe: string) => string> = {
  momentum_trader: (asset, timeframe) =>
    `You are a momentum trader analyzing a news event's impact on ${asset}. Focus on: price action implications, key technical levels likely to be tested, breakout/breakdown probability, volume and volatility expectations. Ignore fundamentals — only what the chart and momentum will do in the next ${timeframe}.`,
  macro_fund: (asset, timeframe) =>
    `You are a macro portfolio manager analyzing a news event's impact on ${asset}. Focus on: fundamental repricing, interest rate and growth implications, positioning and flow dynamics, how this changes the medium-term thesis. Think in terms of large position sizing and multi-day impact.`,
  retail_crowd: (asset, _timeframe) =>
    `You are modeling how retail traders and social media will react to this news event for ${asset}. Focus on: sentiment direction, FOMO vs panic dynamics, which narrative will dominate on trading forums, how retail positioning will move and whether it creates a fade opportunity.`,
  market_maker: (asset, _timeframe) =>
    `You are a market maker analyzing a news event's impact on ${asset}. Focus on: expected spread widening, liquidity withdrawal risk, options hedging pressure, where stop clusters are likely, whether this creates a liquidity vacuum or orderly repricing.`,
  risk_officer: (asset, _timeframe) =>
    `You are a chief risk officer stress-testing a news event against ${asset} exposure. Focus on: tail risk scenarios, correlation breakdown risk, what the market is not pricing in, black swan potential, maximum adverse excursion estimate.`,
  central_bank_watcher: (asset, _timeframe) =>
    `You are a former central bank economist analyzing a news event's impact on ${asset}. Focus on: what this signals about the rate path of relevant central banks, how it shifts forward guidance expectations, probability of policy action changes at upcoming meetings, and how the yield differential between currencies will reprice. Think in terms of rate differentials and monetary policy divergence.`,
  options_trader: (asset, _timeframe) =>
    `You are an options trader analyzing a news event's impact on ${asset}. Focus on: implied volatility repricing, gamma exposure and where market makers need to hedge, put/call skew shifts, key strike levels that will act as magnets or barriers, and whether this is a vol expansion or vol crush event. Think in terms of where the hedging flows will physically push spot price.`,
  quant_fund: (asset, _timeframe) =>
    `You are modeling how systematic and algorithmic strategies will react to this news event for ${asset}. Focus on: whether trend-following CTAs will add to or reverse positions, stat arb dislocations this creates, how momentum signals will flip, estimated size of systematic flows and their timing, and whether this event triggers stop-runs on known systematic levels.`,
  bond_market: (asset, _timeframe) =>
    `You are a rates trader analyzing a news event's impact on ${asset} through the bond market lens. Focus on: yield curve implications, how this reprices the front end vs long end, real yield shifts, flight-to-safety flows, duration risk repricing, and how bond market moves will transmit into currency markets via rate differentials and carry dynamics.`,
};

// Per-agent, per-asset-class addendum injected into user message
function getAssetClassAddendum(
  agentName: AgentName,
  assetClass: EventClassification['primary_asset_class'] | undefined
): string {
  if (!assetClass) return '';
  const map: Partial<Record<AgentName, Partial<Record<string, string>>>> = {
    macro_fund: {
      commodity: 'Consider supply chain disruption and inventory dynamics.',
      forex: 'Consider current account and capital flow implications.',
    },
    risk_officer: {
      commodity: 'Consider physical delivery risk and contango/backwardation.',
    },
    central_bank_watcher: {
      commodity: 'Consider inflationary pass-through implications.',
      forex: 'Focus on divergence between the two relevant central banks.',
    },
    bond_market: {
      forex: 'Focus specifically on yield differential between the two currencies.',
    },
    retail_crowd: {
      equity: 'Consider earnings implications and analyst revision expectations.',
    },
    quant_fund: {
      equity: 'Consider sector rotation and factor exposure.',
    },
  };
  return map[agentName]?.[assetClass] ?? '';
}

const HORIZON_LABEL: Record<string, string> = {
  '1W': 'next 7 days / weekly horizon',
  '1M': 'next 30 days / monthly horizon',
};

const JAPAN_ASSETS = new Set(['NKY', 'TOPIX', 'EWJ']);

const JAPAN_CONTEXT = `Japan market context: USD/JPY is the primary driver of Japanese equity returns — yen weakness is bullish for Nikkei exporters, yen strength is bearish. BOJ policy is the dominant macro force. Foreign investor flows account for ~70% of TSE volume and drive momentum. TSE corporate governance reforms since 2023 have increased buybacks and improved ROE focus. Consider these dynamics in your analysis.`;

const JAPAN_AGENT_ADDENDUM: Partial<Record<AgentName, string>> = {
  central_bank_watcher: 'Focus specifically on BOJ yield curve control policy, any deviation from 0% 10Y JGB target, and implications for yen carry trade unwinding.',
  macro_fund:           'Consider the yen-equity inverse correlation, current account surplus dynamics, and how global risk sentiment affects foreign flows into Japanese equities.',
  momentum_trader:      'Nikkei futures trade on OSE — consider overnight US futures direction and USD/JPY open as primary momentum inputs.',
  quant_fund:           'CTAs have historically been large Nikkei trend followers. Consider whether current trend signals are long or short and how this news affects their positioning.',
};

function buildUserMessage(
  eventText: string,
  asset: string,
  timeframe: string,
  volatilityRegime: string,
  classification: EventClassification | null,
  agentName: AgentName
): string {
  const horizonLabel = HORIZON_LABEL[timeframe] ?? timeframe;
  const classLine = classification
    ? `Event type: ${classification.event_type} | Severity: ${classification.severity} | Directional clarity: ${classification.directional_clarity}`
    : '';
  const assetAddendum = classification
    ? getAssetClassAddendum(agentName, classification.primary_asset_class)
    : '';
  const contextBlock = [classLine, assetAddendum].filter(Boolean).join('\n');

  const japanBlock = JAPAN_ASSETS.has(asset)
    ? [JAPAN_CONTEXT, JAPAN_AGENT_ADDENDUM[agentName]].filter(Boolean).join('\n')
    : '';

  return `News event: ${eventText}
Asset: ${asset}
Timeframe: ${timeframe} (${horizonLabel})
Current volatility regime: ${volatilityRegime}${contextBlock ? '\n' + contextBlock : ''}${japanBlock ? '\n\n' + japanBlock : ''}

Respond ONLY with a JSON object, no markdown, no explanation:
{"direction":"bullish|bearish|neutral","conviction":1-10,"timeframe":"string","reasoning":"2-3 sentences","key_factors":["string","string","string"]}`;
}

async function callAgent(
  agentName: AgentName,
  eventText: string,
  asset: string,
  timeframe: string,
  volatilityRegime: string,
  classification: EventClassification | null,
  model: string = 'claude-sonnet-5-5'
): Promise<AgentResult> {
  const response = await postAnalyze({
    model,
    system: SYSTEM_PROMPTS[agentName](asset, timeframe),
    // Headroom for adaptive thinking, which counts toward max_tokens.
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: buildUserMessage(eventText, asset, timeframe, volatilityRegime, classification, agentName),
      },
    ],
  }, AbortSignal.timeout(30_000));

  if (!response.ok) throw new Error(`Agent ${agentName} failed: ${response.status}`);

  const text = extractText(await response.json(), `Agent ${agentName}`);

  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(cleaned) as AgentResult;
}

export async function synthesizeAgents(
  eventText: string,
  asset: string,
  timeframe: string,
  agentResults: Record<AgentName, AgentResult | null>
): Promise<{ summary: string; themes: string[]; key_contradiction: KeyContradiction | null }> {
  const lines = AGENT_NAMES.map((name) => {
    const r = agentResults[name];
    if (!r) return null;
    return `- ${AGENT_DISPLAY_NAMES[name]}: ${r.direction} ${r.conviction}/10 — ${r.reasoning}`;
  }).filter(Boolean).join('\n');

  const userContent = `Asset: ${asset} | Timeframe: ${timeframe} | Event: ${eventText}
Agent assessments:
${lines}

Respond ONLY with a JSON object:
{"summary":"4-6 sentence synthesis paragraph","themes":["theme1","theme2","theme3"],"key_contradiction":{"agent1":"name","agent2":"name","reason":"one sentence explaining the disagreement"}}

Use null for key_contradiction if agents broadly agree (no meaningful split).`;

  const response = await postAnalyze({
    model: 'claude-sonnet-5-5',
    max_tokens: 2048,
    system: 'You are a senior trading desk analyst. You receive the independent assessments of 9 specialist agents who have each analyzed the same news event from different perspectives. Your job is to synthesize their views into one clear, concise analytical paragraph that a discretionary trader can read in 5 seconds and understand the dominant narrative, key risks, and any notable disagreements. Also identify the single most important contradiction between any two agents. Be direct. No fluff. Write like you are talking to a professional trader.',
    messages: [{ role: 'user', content: userContent }],
  }, AbortSignal.timeout(30_000));

  if (!response.ok) throw new Error(`Synthesis failed: ${response.status}`);

  const text = extractText(await response.json(), 'Synthesis');

  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  const parsed = JSON.parse(cleaned) as {
    summary: string;
    themes: string[];
    key_contradiction: KeyContradiction | null;
  };

  return {
    summary: parsed.summary ?? '',
    themes: Array.isArray(parsed.themes) ? parsed.themes : [],
    key_contradiction: parsed.key_contradiction ?? null,
  };
}

export async function runAgentSwarm(
  eventText: string,
  asset: string,
  timeframe: string,
  volatilityRegime: string,
  onUpdate: (name: AgentName, status: AgentStatus, result?: AgentResult) => void,
  classification: EventClassification | null = null,
  model: string = 'claude-sonnet-5-5'
): Promise<Record<AgentName, AgentResult | null>> {
  const results: Record<string, AgentResult | null> = {};

  const promises = AGENT_NAMES.map(async (name) => {
    onUpdate(name, 'loading');
    try {
      const result = await callAgent(name, eventText, asset, timeframe, volatilityRegime, classification, model);
      results[name] = result;
      onUpdate(name, 'complete', result);
    } catch {
      // Retry once
      try {
        const result = await callAgent(name, eventText, asset, timeframe, volatilityRegime, classification, model);
        results[name] = result;
        onUpdate(name, 'complete', result);
      } catch {
        results[name] = null;
        onUpdate(name, 'error');
      }
    }
  });

  await Promise.all(promises);
  return results as Record<AgentName, AgentResult | null>;
}
