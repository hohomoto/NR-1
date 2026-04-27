import type { AgentName, AgentResult, AgentStatus } from '../types';
import { runAgentSwarm } from './agentSwarm';

export async function runOpusEscalation(
  eventText: string,
  asset: string,
  timeframe: string,
  volatilityRegime: string,
  onUpdate: (name: AgentName, status: AgentStatus, result?: AgentResult) => void
): Promise<Record<AgentName, AgentResult | null>> {
  return runAgentSwarm(
    eventText,
    asset,
    timeframe,
    volatilityRegime,
    onUpdate,
    null,
    'claude-opus-4-5'
  );
}
