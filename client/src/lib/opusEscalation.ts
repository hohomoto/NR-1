import type { AgentName, AgentResult, AgentStatus, EventClassification } from '../types';
import { runAgentSwarm } from './agentSwarm';

export async function runOpusEscalation(
  eventText: string,
  asset: string,
  timeframe: string,
  volatilityRegime: string,
  onUpdate: (name: AgentName, status: AgentStatus, result?: AgentResult) => void,
  classification: EventClassification | null
): Promise<Record<AgentName, AgentResult | null>> {
  return runAgentSwarm(
    eventText,
    asset,
    timeframe,
    volatilityRegime,
    onUpdate,
    classification,
    'claude-opus-4-5'
  );
}
