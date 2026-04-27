import { useNR1Store } from '../store/useNR1Store';
import { AGENT_NAMES, AGENT_DISPLAY_NAMES } from '../types';
import { getAgentWeights } from '../lib/signalAggregator';

export function ConsensusBreakdown() {
  const agentResults      = useNR1Store((s) => s.agentResults);
  const analysisComplete  = useNR1Store((s) => s.analysisComplete);
  const classification    = useNR1Store((s) => s.eventClassification);

  const weights = getAgentWeights(classification?.event_type);

  if (!analysisComplete) {
    return (
      <div className="p-4 border-t border-border">
        <div className="text-xs font-mono text-text-dim uppercase tracking-widest mb-3">
          Agent Consensus
        </div>
        <div className="text-center py-4 text-text-dim text-xs font-sans">
          Awaiting results...
        </div>
      </div>
    );
  }

  const completed  = AGENT_NAMES.filter((n) => agentResults[n] !== null);
  const directions = completed.map((n) => agentResults[n]!.direction);
  const bullish    = directions.filter((d) => d === 'bullish').length;
  const bearish    = directions.filter((d) => d === 'bearish').length;
  const neutral    = directions.filter((d) => d === 'neutral').length;

  let summary = 'MIXED';
  if (bullish > bearish && bullish > neutral) summary = `${bullish}/${completed.length} BULLISH`;
  else if (bearish > bullish && bearish > neutral) summary = `${bearish}/${completed.length} BEARISH`;

  return (
    <div className="p-4 border-t border-border">
      <div className="text-xs font-mono text-text-dim uppercase tracking-widest mb-3">
        Agent Consensus
      </div>

      <div className="space-y-1.5">
        {AGENT_NAMES.map((name) => {
          const result = agentResults[name];
          const weight = weights[name] ?? 1.0;
          const isHighWeight = weight > 1.2;
          const isLowWeight  = weight < 0.9;

          if (!result) {
            return (
              <div key={name} className="flex items-center gap-2">
                <span className="text-xs font-sans text-text-dim w-28 truncate">
                  {AGENT_DISPLAY_NAMES[name]}
                </span>
                <span className="w-2 h-2 rounded-full bg-text-dim" />
              </div>
            );
          }

          const dotColor =
            result.direction === 'bullish' ? 'bg-green'
            : result.direction === 'bearish' ? 'bg-red'
            : 'bg-blue';

          const barColor =
            result.direction === 'bullish' ? 'bg-green'
            : result.direction === 'bearish' ? 'bg-red'
            : 'bg-blue';

          return (
            <div key={name} className="flex items-center gap-2">
              <span className="text-xs font-sans text-text-muted w-28 truncate shrink-0">
                {AGENT_DISPLAY_NAMES[name]}
              </span>
              <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
              <div className="flex gap-px flex-1">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 flex-1 rounded-sm ${i < result.conviction ? barColor : 'bg-background'}`}
                  />
                ))}
              </div>
              {/* Weight multiplier badge — only show when classification active */}
              {classification && (
                <span
                  className="font-mono shrink-0"
                  style={{
                    fontSize: '9px',
                    color: isHighWeight ? '#f59e0b' : isLowWeight ? '#444' : '#333',
                    minWidth: '28px',
                    textAlign: 'right',
                  }}
                >
                  ×{weight.toFixed(1)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 text-xs font-mono text-text-primary">{summary}</div>
    </div>
  );
}
