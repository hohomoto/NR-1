import { useNR1Store } from '../store/useNR1Store';

const BIN_LABELS = ['-3%+', '-2%', '-1%', 'Flat', '+1%', '+2%', '+3%+'];

export function ProbabilityHistogram() {
  const nnOutput = useNR1Store((s) => s.nnOutput);
  const nnWeightSource = useNR1Store((s) => s.nnWeightSource);

  if (!nnOutput) {
    return (
      <div className="p-4 border-t border-border">
        <div className="text-xs font-mono text-text-dim uppercase tracking-widest mb-3">
          Price Movement Distribution
        </div>
        <div className="text-center py-6 text-text-dim text-xs font-sans">
          Awaiting NN output...
        </div>
      </div>
    );
  }

  const maxVal = Math.max(...nnOutput);
  const peakIdx = nnOutput.indexOf(maxVal);
  const chartHeight = 100;
  const barWidth = 32;
  const gap = 6;
  const totalWidth = nnOutput.length * (barWidth + gap) - gap;

  return (
    <div className="p-4 border-t border-border">
      <div className="text-xs font-mono text-text-dim uppercase tracking-widest mb-3">
        Price Movement Distribution
      </div>

      <div className="flex justify-center">
        <svg
          width={totalWidth + 20}
          height={chartHeight + 40}
          viewBox={`0 0 ${totalWidth + 20} ${chartHeight + 40}`}
        >
          {nnOutput.map((val, i) => {
            const barHeight = Math.max((val / (maxVal * 1.2)) * chartHeight, 2);
            const x = 10 + i * (barWidth + gap);
            const y = chartHeight - barHeight;
            const isPeak = i === peakIdx;

            let fill: string;
            if (i < 3) fill = '#ef4444'; // red
            else if (i === 3) fill = '#3b82f6'; // blue
            else fill = '#22c55e'; // green

            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill={fill}
                  opacity={isPeak ? 1 : 0.6}
                />
                {isPeak && (
                  <text
                    x={x + barWidth / 2}
                    y={y - 4}
                    textAnchor="middle"
                    fill="#e5e5e5"
                    fontSize="10"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {(val * 100).toFixed(1)}%
                  </text>
                )}
                <text
                  x={x + barWidth / 2}
                  y={chartHeight + 14}
                  textAnchor="middle"
                  fill="#444444"
                  fontSize="9"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {BIN_LABELS[i]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="text-xs font-mono text-text-dim">
          <span className="text-text-muted">NN CONFIDENCE</span>{' '}
          <span className="text-text-primary">{(maxVal * 100).toFixed(1)}%</span>
        </div>
        <div className="text-xs font-mono text-text-dim">
          TensorFlow.js · {nnWeightSource} weights
        </div>
      </div>
    </div>
  );
}
