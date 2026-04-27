import { useState } from 'react';
import type { AgentName, AgentResult, AgentStatus } from '../types';
import { AGENT_DISPLAY_NAMES } from '../types';

interface Props {
  name: AgentName;
  status: AgentStatus;
  result: AgentResult | null;
}

export function AgentCard({ name, status, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const displayName = AGENT_DISPLAY_NAMES[name];

  if (status === 'pending') {
    return (
      <div className="bg-panel border border-border rounded-sm px-2.5 py-2 h-9 flex items-center gap-2">
        <span className="text-xs font-sans text-text-dim flex-1">{displayName}</span>
        <div className="h-2 w-12 bg-background rounded-sm animate-pulse" />
        <div className="h-2 w-8 bg-background rounded-sm animate-pulse" />
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="bg-panel border border-border border-l-amber border-l-2 rounded-sm px-2.5 py-2 h-9 flex items-center gap-2">
        <span className="text-xs font-sans text-text-muted flex-1">{displayName}</span>
        <span className="text-xs font-mono text-amber animate-pulse">ANALYZING...</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="bg-panel border border-border border-l-red border-l-2 rounded-sm px-2.5 py-2 h-9 flex items-center gap-2">
        <span className="text-xs font-sans text-text-muted flex-1">{displayName}</span>
        <span className="text-xs font-mono text-red">UNAVAILABLE</span>
      </div>
    );
  }

  if (!result) return null;

  const dirColor =
    result.direction === 'bullish'
      ? 'text-green'
      : result.direction === 'bearish'
        ? 'text-red'
        : 'text-blue';

  const dirBg =
    result.direction === 'bullish'
      ? 'bg-green-dim'
      : result.direction === 'bearish'
        ? 'bg-red-dim'
        : 'bg-blue/10';

  return (
    <div
      className="bg-panel border border-border rounded-sm overflow-hidden cursor-pointer select-none"
      onClick={() => setExpanded((e) => !e)}
    >
      {/* Collapsed row — always visible */}
      <div className="flex items-center gap-2 px-2.5 h-9">
        <span className="text-xs font-sans text-text-muted flex-1 truncate">{displayName}</span>
        <span className={`px-1.5 py-0.5 text-xs font-mono font-bold rounded-sm ${dirColor} ${dirBg}`}>
          {result.direction.toUpperCase()}
        </span>
        <span className={`text-sm font-mono font-bold ${dirColor} w-10 text-right`}>
          {result.conviction}/10
        </span>
        <span
          className="text-text-dim text-xs ml-1 transition-transform duration-200"
          style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ▸
        </span>
      </div>

      {/* Expandable details */}
      <div
        style={{
          maxHeight: expanded ? '300px' : '0px',
          transition: 'max-height 0.2s ease',
          overflow: 'hidden',
        }}
      >
        <div className="px-2.5 pb-2.5 border-t border-border pt-2">
          <div className="text-xs font-mono text-text-dim mb-1.5">{result.timeframe}</div>
          <p className="text-xs font-sans text-text-primary leading-relaxed mb-1.5">
            {result.reasoning}
          </p>
          <div className="flex flex-wrap gap-1">
            {result.key_factors.map((f, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 text-xs font-sans text-text-dim bg-background rounded-sm"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
