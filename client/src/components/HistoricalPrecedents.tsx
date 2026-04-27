import { useNR1Store } from '../store/useNR1Store';

export function HistoricalPrecedents() {
  const patternResults = useNR1Store((s) => s.patternResults);
  const patternStatus = useNR1Store((s) => s.patternStatus);

  if (patternStatus === 'idle') return null;

  if (patternStatus === 'loading') {
    return (
      <div className="p-3">
        <div className="text-xs font-sans text-text-muted uppercase tracking-wider mb-2">
          Historical Precedents
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-background border border-border rounded-sm p-2">
              <div className="h-3 bg-panel rounded-sm animate-pulse mb-1" />
              <div className="h-3 bg-panel rounded-sm animate-pulse w-2/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (patternStatus === 'error') {
    return (
      <div className="p-3">
        <div className="text-xs font-sans text-text-muted uppercase tracking-wider mb-2">
          Historical Precedents
        </div>
        <div className="text-xs text-red font-mono">Pattern agent unavailable</div>
      </div>
    );
  }

  if (!patternResults || patternResults.length === 0) return null;

  return (
    <div className="p-3">
      <div className="text-xs font-sans text-text-muted uppercase tracking-wider mb-2">
        Historical Precedents
      </div>
      <div className="space-y-2">
        {patternResults.map((a, i) => (
          <div key={i} className="bg-background border border-border rounded-sm p-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-text-primary">{a.date}</span>
              <span className="text-xs font-mono text-text-dim">{a.asset}</span>
              <span
                className={`px-1.5 py-0.5 text-xs font-mono rounded-sm ${
                  a.outcome === 'bullish'
                    ? 'text-green bg-green-dim'
                    : a.outcome === 'bearish'
                      ? 'text-red bg-red-dim'
                      : 'text-blue bg-blue/10'
                }`}
              >
                {a.outcome.toUpperCase()}
              </span>
              <span className="text-xs font-mono text-text-dim ml-auto">
                {a.magnitude}
              </span>
            </div>
            <p className="text-xs font-sans text-text-muted">{a.event}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
