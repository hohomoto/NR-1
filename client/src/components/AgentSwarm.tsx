import { useNR1Store } from '../store/useNR1Store';
import { AGENT_NAMES } from '../types';
import { AgentCard } from './AgentCard';
import { AgentSummary } from './AgentSummary';

export function AgentSwarm() {
  const agentResults = useNR1Store((s) => s.agentResults);
  const agentStatus = useNR1Store((s) => s.agentStatus);
  const escalationInProgress = useNR1Store((s) => s.escalationInProgress);
  const didEscalate = useNR1Store((s) => s.didEscalate);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="text-xs font-mono text-text-dim uppercase tracking-widest">
          Agent Swarm
        </div>
      </div>

      {(escalationInProgress || didEscalate) && (
        <div className="mx-3 mb-2 px-3 py-2 border border-amber bg-amber-dim rounded-sm text-xs font-mono text-amber text-center shrink-0">
          {escalationInProgress
            ? 'CONFLICT DETECTED — ESCALATING TO OPUS'
            : 'ESCALATED TO OPUS — RESULTS UPDATED'}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="space-y-1.5">
          {AGENT_NAMES.map((name) => (
            <AgentCard
              key={name}
              name={name}
              status={agentStatus[name]}
              result={agentResults[name]}
            />
          ))}
        </div>
        <AgentSummary />
      </div>
    </div>
  );
}
