import { useNR1Store } from '../store/useNR1Store';
import type { VolatilityRegime } from '../types';
import { NeuralNetVisualizer } from './NeuralNetVisualizer';

const SEVERITY_COLOR: Record<string, string> = {
  low:     '#444',
  medium:  '#3b82f6',
  high:    '#f59e0b',
  extreme: '#ef4444',
};

const TYPE_LABEL: Record<string, string> = {
  geopolitical:    'GEOPOLITICAL',
  central_bank:    'CENTRAL BANK',
  data_release:    'DATA RELEASE',
  corporate:       'CORPORATE',
  commodity_supply:'SUPPLY SHOCK',
  risk_off:        'RISK-OFF',
  other:           'OTHER',
};

export function EventInput() {
  const eventText           = useNR1Store((s) => s.eventText);
  const setEventText        = useNR1Store((s) => s.setEventText);
  const asset               = useNR1Store((s) => s.asset);
  const setAsset            = useNR1Store((s) => s.setAsset);
  const volatilityRegime    = useNR1Store((s) => s.volatilityRegime);
  const setVolatilityRegime = useNR1Store((s) => s.setVolatilityRegime);
  const runAnalysis         = useNR1Store((s) => s.runAnalysis);
  const isRunning           = useNR1Store((s) => s.isRunning);
  const classification      = useNR1Store((s) => s.eventClassification);
  const classificationStatus = useNR1Store((s) => s.classificationStatus);

  const showPill = classificationStatus === 'loading' || (classificationStatus === 'complete' && classification);

  return (
    <div className="flex flex-col">
      <div className="p-3 flex flex-col gap-2">
        <div>
          <label className="text-xs font-sans text-text-muted uppercase tracking-wider block mb-1">
            Event
          </label>
          <textarea
            value={eventText}
            onChange={(e) => setEventText(e.target.value)}
            placeholder="Paste or type the news event..."
            className="w-full h-24 bg-background border border-border rounded-sm p-2 text-sm font-mono text-text-primary placeholder:text-text-dim resize-none focus:outline-none focus:border-border-bright"
          />
          {/* Event classification pill */}
          {showPill && (
            <div className="mt-1.5 flex items-center gap-1.5">
              {classificationStatus === 'loading' && (
                <span
                  className="font-mono animate-pulse"
                  style={{ fontSize: '9px', color: '#444', letterSpacing: '0.1em' }}
                >
                  CLASSIFYING...
                </span>
              )}
              {classificationStatus === 'complete' && classification && (
                <>
                  <span
                    className="font-mono px-1.5 py-0.5 rounded-sm"
                    style={{
                      fontSize: '9px',
                      letterSpacing: '0.1em',
                      color: SEVERITY_COLOR[classification.severity] ?? '#444',
                      border: `1px solid ${SEVERITY_COLOR[classification.severity] ?? '#444'}22`,
                      background: `${SEVERITY_COLOR[classification.severity] ?? '#444'}11`,
                    }}
                  >
                    {TYPE_LABEL[classification.event_type] ?? classification.event_type.toUpperCase()}
                    {' · '}
                    {classification.severity.toUpperCase()}
                  </span>
                  {classification.directional_clarity !== 'clear' && (
                    <span
                      className="font-mono px-1.5 py-0.5 rounded-sm"
                      style={{
                        fontSize: '9px',
                        letterSpacing: '0.1em',
                        color: classification.directional_clarity === 'contradictory' ? '#ef4444' : '#888',
                        border: '1px solid #1e1e24',
                      }}
                    >
                      {classification.directional_clarity.toUpperCase()}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-sans text-text-muted uppercase tracking-wider block mb-1">
            Asset Context
          </label>
          <input
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            className="w-full bg-background border border-border rounded-sm px-2 py-1.5 text-sm font-mono text-text-primary focus:outline-none focus:border-border-bright"
          />
        </div>

        <div>
          <label className="text-xs font-sans text-text-muted uppercase tracking-wider block mb-1">
            Volatility Regime
          </label>
          <select
            value={volatilityRegime}
            onChange={(e) => setVolatilityRegime(e.target.value as VolatilityRegime)}
            className="w-full bg-background border border-border rounded-sm px-2 py-1.5 text-sm font-mono text-text-primary focus:outline-none focus:border-border-bright"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <button
          onClick={() => runAnalysis()}
          disabled={isRunning || !eventText.trim()}
          className="w-full bg-amber text-background font-mono font-bold py-2.5 rounded-sm text-sm hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed relative"
        >
          {isRunning ? 'ANALYZING...' : 'RUN ANALYSIS'}
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs opacity-60">
            {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+↵
          </span>
        </button>
      </div>

      <div className="border-t border-border px-3 pb-3">
        <NeuralNetVisualizer />
      </div>
    </div>
  );
}
