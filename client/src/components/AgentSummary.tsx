import { useNR1Store } from '../store/useNR1Store';

export function AgentSummary() {
  const synthesisStatus  = useNR1Store((s) => s.synthesisStatus);
  const synthesisSummary = useNR1Store((s) => s.synthesisSummary);
  const synthesisThemes  = useNR1Store((s) => s.synthesisThemes);
  const keyContradiction = useNR1Store((s) => s.keyContradiction);

  if (synthesisStatus === 'idle') return null;

  return (
    <div className="border-t border-border mt-1.5 pt-3 pb-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-amber/60 uppercase tracking-widest">
          Synthesis
        </span>
        {synthesisStatus === 'complete' && (
          <span className="text-xs font-mono text-text-dim">9 AGENTS</span>
        )}
      </div>

      {(synthesisStatus === 'loading' || synthesisStatus === 'error') && (
        <div className="text-xs font-mono text-text-dim animate-pulse">
          {synthesisStatus === 'error' ? 'SYNTHESIS UNAVAILABLE' : 'SYNTHESIZING...'}
        </div>
      )}

      {synthesisStatus === 'complete' && synthesisSummary && (
        <>
          <p className="font-sans text-text-primary" style={{ fontSize: '13px', lineHeight: '1.7' }}>
            {synthesisSummary}
          </p>

          {synthesisThemes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {synthesisThemes.map((theme, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-xs font-sans text-text-dim bg-background border border-border rounded-sm"
                >
                  {theme}
                </span>
              ))}
            </div>
          )}

          {keyContradiction && (
            <div className="mt-3">
              <div
                className="font-mono uppercase tracking-widest mb-1"
                style={{ fontSize: '9px', color: '#444' }}
              >
                Key Contradiction
              </div>
              <div
                className="px-2.5 py-2 rounded-sm font-sans"
                style={{
                  background: 'rgba(120,73,10,0.13)',
                  border: '1px solid #78490a',
                  fontSize: '11px',
                  color: '#f59e0b',
                  lineHeight: '1.5',
                }}
              >
                ⚡{' '}
                <span style={{ fontWeight: 600 }}>{keyContradiction.agent1}</span>
                {' vs '}
                <span style={{ fontWeight: 600 }}>{keyContradiction.agent2}</span>
                {' — '}
                {keyContradiction.reason}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
