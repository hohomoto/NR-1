import { useNR1Store } from '../store/useNR1Store';

export function SignalPanel() {
  const finalSignal = useNR1Store((s) => s.finalSignal);
  const asset = useNR1Store((s) => s.asset);
  const timeframe = useNR1Store((s) => s.timeframe);
  const analysisComplete = useNR1Store((s) => s.analysisComplete);
  const nnWeightSource = useNR1Store((s) => s.nnWeightSource);
  const nnTrainedExamples = useNR1Store((s) => s.nnTrainedExamples);

  if (!analysisComplete || !finalSignal) {
    return (
      <div className="p-4">
        <div className="text-xs font-mono text-text-dim uppercase tracking-widest mb-3">
          Final Signal
        </div>
        <div className="text-center py-8 text-text-dim text-xs font-sans">
          Awaiting analysis...
        </div>
      </div>
    );
  }

  const { direction, confidence, conflictDetected, didEscalate } = finalSignal;
  const arrow = direction === 'bullish' ? '↑' : direction === 'bearish' ? '↓' : '→';
  const label = direction === 'bullish' ? 'BULLISH' : direction === 'bearish' ? 'BEARISH' : 'FLAT';
  const color = direction === 'bullish' ? 'text-green' : direction === 'bearish' ? 'text-red' : 'text-blue';

  return (
    <div className="p-4">
      <div className="text-xs font-mono text-text-dim uppercase tracking-widest mb-3">
        Final Signal
      </div>

      <div className={`text-[28px] font-mono font-bold ${color} mb-1`}>
        {arrow} {label}
      </div>

      <div className="text-[48px] font-mono font-bold text-amber leading-none mb-1">
        {confidence}%
      </div>

      {/* Horizon label */}
      {(() => {
        const isJapan = ['NKY', 'TOPIX', 'EWJ'].includes(asset);
        const label = isJapan && timeframe === '1W'
          ? 'JAPAN EQUITY SIGNAL · 7-30 DAY HORIZON'
          : timeframe === '1W'
          ? 'SWING SIGNAL · 7-30 DAY HORIZON'
          : 'POSITION SIGNAL · 30 DAY HORIZON';
        return (
          <>
            <div
              className="text-[9px] font-mono tracking-widest mb-0.5"
              style={{ color: 'rgba(245,158,11,0.45)' }}
            >
              {label}
            </div>
            {isJapan && (
              <div className="text-[9px] font-mono mb-1" style={{ color: 'rgba(245,158,11,0.3)' }}>
                USD/JPY correlation active
              </div>
            )}
          </>
        );
      })()}

      {/* NN weight source label */}
      <div className={`text-[10px] font-mono tracking-widest mb-2 ${
        nnWeightSource === 'trained' ? 'text-green opacity-60' : 'text-amber opacity-40'
      }`}>
        {nnWeightSource === 'trained'
          ? `NN: TRAINED · ${nnTrainedExamples} EXAMPLES`
          : 'NN: SYNTHETIC WEIGHTS'}
      </div>

      <div className="text-xs font-mono text-text-dim mb-3">
        {asset} · {timeframe}
      </div>

      {conflictDetected && (
        <div className="inline-block px-2 py-1 text-xs font-mono text-amber bg-amber-dim rounded-sm mb-1">
          ⚠ SPLIT SIGNAL
        </div>
      )}

      {didEscalate && (
        <div className="text-xs font-mono text-text-dim mt-1">
          Resolved via Opus escalation
        </div>
      )}
    </div>
  );
}
