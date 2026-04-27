import { useRef, useEffect, useState } from 'react';
import { useNR1Store } from '../store/useNR1Store';
import type { CarryTradeRisk, SectorRotation } from '../types';

// ─── Style constants ──────────────────────────────────────────────────────────
const MONO = 'JetBrains Mono, monospace';
const SANS = 'Geist, Inter, sans-serif';

const SECTION: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #1e1e24',
};

const LABEL: React.CSSProperties = {
  fontSize: 9,
  color: '#333',
  fontFamily: MONO,
  letterSpacing: '0.1em',
  marginBottom: 7,
};

const CARRY_STYLE: Record<CarryTradeRisk, { bg: string; fg: string; border: string }> = {
  low:      { bg: '#052e16', fg: '#22c55e', border: '#22c55e22' },
  elevated: { bg: '#451a03', fg: '#f59e0b', border: '#f59e0b22' },
  critical: { bg: '#450a0a', fg: '#ef4444', border: '#ef444422' },
  unknown:  { bg: '#18181b', fg: '#555555', border: '#55555522' },
};

const CARRY_DESC: Record<CarryTradeRisk, string> = {
  low:      'Yen stable — carry unwind risk minimal',
  elevated: 'Yen moving — monitor carry positions',
  critical: 'Rapid yen move — carry unwind risk HIGH',
  unknown:  'IB offline — carry data unavailable',
};

// ─── JapanIntelPanel ─────────────────────────────────────────────────────────

export function JapanIntelPanel() {
  const [collapsed, setCollapsed] = useState(false);
  // Local ref for high-frequency USD/JPY history (not in Zustand per spec)
  const priceHistory = useRef<{ price: number; ts: number }[]>([]);
  // Local display state for sector rotation (computed from priceHistory ref)
  const [localSector, setLocalSector] = useState<SectorRotation>('accumulating');

  const carryTradeRisk        = useNR1Store((s) => s.carryTradeRisk);
  const usdJpyPrice           = useNR1Store((s) => s.usdJpyPrice);
  const jgbYield              = useNR1Store((s) => s.jgbYield);
  const jgbChange             = useNR1Store((s) => s.jgbChange);
  const shuntoFlag            = useNR1Store((s) => s.shuntoFlag);
  const tseReformFlag         = useNR1Store((s) => s.tseReformFlag);
  const bojFlag               = useNR1Store((s) => s.bojFlag);
  const foreignFlowDirection  = useNR1Store((s) => s.foreignFlowDirection);
  const foreignFlowConviction = useNR1Store((s) => s.foreignFlowConviction);
  const foreignFlowReasoning  = useNR1Store((s) => s.foreignFlowReasoning);
  const foreignFlowKeyDriver  = useNR1Store((s) => s.foreignFlowKeyDriver);
  const eventText             = useNR1Store((s) => s.eventText);

  const setCarryTradeRisk  = useNR1Store((s) => s.setCarryTradeRisk);
  const setUsdJpyPrice     = useNR1Store((s) => s.setUsdJpyPrice);
  const setSectorRotation  = useNR1Store((s) => s.setSectorRotation);
  const setStructuralFlags = useNR1Store((s) => s.setStructuralFlags);
  const fetchJgb           = useNR1Store((s) => s.fetchJgb);

  // ── Poll USD/JPY every 30 s ─────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const res  = await fetch('/api/price/USD%2FJPY');
        const data = await res.json() as { mid: number | null };
        if (data.mid == null) return;

        const ts   = Date.now();
        const hist = priceHistory.current;
        hist.push({ price: data.mid, ts });
        if (hist.length > 10) hist.shift();

        setUsdJpyPrice(data.mid);

        // Carry risk — compare to reading closest to 60 s ago
        if (hist.length >= 2) {
          const TARGET  = ts - 60_000;
          const ref     = hist.slice(0, -1).reduce(
            (best, h) => Math.abs(h.ts - TARGET) < Math.abs(best.ts - TARGET) ? h : best,
            hist[0]
          );
          if (Math.abs(ref.ts - TARGET) < 50_000) {
            const move = Math.abs((data.mid - ref.price) / ref.price * 100);
            setCarryTradeRisk(move > 0.5 ? 'critical' : move > 0.2 ? 'elevated' : 'low');
          }
        }

        // Sector rotation — oldest vs latest reading
        if (hist.length >= 3) {
          const movePct = (data.mid - hist[0].price) / hist[0].price * 100;
          const rot: SectorRotation =
            movePct > 0.1 ? 'exporters' : movePct < -0.1 ? 'domestics' : 'neutral';
          setLocalSector(rot);
          setSectorRotation(rot);
        }
      } catch { /* IB offline — keep previous values */ }
    };
    poll();
    const iv = setInterval(poll, 30_000);
    return () => clearInterval(iv);
  }, [setCarryTradeRisk, setUsdJpyPrice, setSectorRotation]);

  // ── Structural flags — reactive to eventText ────────────────────────────
  useEffect(() => {
    setStructuralFlags(eventText);
  }, [eventText, setStructuralFlags]);

  // ── JGB — on mount + every 5 min ────────────────────────────────────────
  useEffect(() => {
    fetchJgb();
    const iv = setInterval(fetchJgb, 5 * 60_000);
    return () => clearInterval(iv);
  }, [fetchJgb]);

  // ── Collapsed icon rail ──────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div style={{
        width: 32, flexShrink: 0,
        borderRight: '1px solid #1e1e24',
        background: '#0a0a0b',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', paddingTop: 12,
      }}>
        <button
          onClick={() => setCollapsed(false)}
          title="Expand Japan Intel"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#f59e0b', fontFamily: MONO, fontSize: 10,
            letterSpacing: '0.08em', writingMode: 'vertical-rl',
            textOrientation: 'mixed', transform: 'rotate(180deg)',
            padding: 0,
          }}
        >
          JP ▶
        </button>
      </div>
    );
  }

  // ── Derived values ───────────────────────────────────────────────────────
  const carry    = CARRY_STYLE[carryTradeRisk];
  const hasFlags = shuntoFlag || tseReformFlag || bojFlag;
  const ffColor  =
    foreignFlowDirection === 'inflow'  ? '#22c55e' :
    foreignFlowDirection === 'outflow' ? '#ef4444' : '#3b82f6';

  const yieldColor =
    jgbChange != null && jgbChange > 0  ? '#ef4444' :
    jgbChange != null && jgbChange < 0  ? '#22c55e' : '#555';

  // ── Expanded panel ───────────────────────────────────────────────────────
  return (
    <div style={{
      width: 200, flexShrink: 0,
      borderRight: '1px solid #1e1e24',
      background: '#0a0a0b',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>

      {/* Header */}
      <div style={{
        ...SECTION,
        borderBottom: '1px solid #1e1e24',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingBottom: 8,
      }}>
        <span style={{ color: '#f59e0b', fontSize: 10, fontFamily: MONO, letterSpacing: '0.12em' }}>
          JAPAN INTEL
        </span>
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#333', fontSize: 10, fontFamily: MONO, padding: 0,
          }}
        >
          ◀
        </button>
      </div>

      {/* ── S1: Carry Trade Risk ─────────────────────────────────────────── */}
      <div style={SECTION}>
        <div style={LABEL}>CARRY TRADE RISK</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
          <span style={{
            fontSize: 9, padding: '2px 6px',
            background: carry.bg, color: carry.fg,
            fontFamily: MONO, letterSpacing: '0.08em',
            border: `1px solid ${carry.border}`,
          }}>
            {carryTradeRisk.toUpperCase()}
          </span>
          {usdJpyPrice != null && (
            <span style={{ fontSize: 10, color: '#666', fontFamily: MONO }}>
              {usdJpyPrice.toFixed(3)}
            </span>
          )}
        </div>
        <div style={{ fontSize: 9, color: '#444', fontFamily: MONO, lineHeight: 1.5 }}>
          {CARRY_DESC[carryTradeRisk]}
        </div>
      </div>

      {/* ── S2: 10Y Yield Proxy ──────────────────────────────────────────── */}
      <div style={SECTION}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 7 }}>
          <span style={{ ...LABEL, marginBottom: 0 }}>10Y YIELD PROXY</span>
          <span style={{ fontSize: 8, color: '#2a2a35', fontFamily: MONO }}>(US proxy)</span>
        </div>
        {jgbYield != null ? (
          <>
            <div style={{ fontSize: 18, color: '#f59e0b', fontFamily: MONO, lineHeight: 1.2, marginBottom: 3 }}>
              {jgbYield.toFixed(3)}%
            </div>
            <div style={{ fontSize: 10, color: yieldColor, fontFamily: MONO, marginBottom: 5 }}>
              {jgbChange != null
                ? (jgbChange >= 0 ? `▲ +${jgbChange.toFixed(3)}` : `▼ ${jgbChange.toFixed(3)}`)
                : '—'}
            </div>
            <div style={{ fontSize: 9, color: '#444', fontFamily: MONO, lineHeight: 1.5 }}>
              {jgbChange != null && jgbChange > 0.05
                ? 'Rates rising · Banks bid · Growth pressured'
                : jgbChange != null && jgbChange < -0.05
                ? 'Rates falling · Risk-off · BOJ dovish signal'
                : 'Yield curve stable'}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 9, color: '#333', fontFamily: MONO }}>Loading yield data…</div>
        )}
      </div>

      {/* ── S3: Sector Rotation ──────────────────────────────────────────── */}
      <div style={SECTION}>
        <div style={LABEL}>SECTOR ROTATION</div>
        {localSector === 'accumulating' ? (
          <div style={{ fontSize: 9, color: '#333', fontFamily: MONO }}>ACCUMULATING DATA…</div>
        ) : localSector === 'neutral' ? (
          <>
            <div style={{ fontSize: 9, color: '#555', fontFamily: MONO, marginBottom: 4 }}>ROTATION NEUTRAL</div>
            <div style={{ fontSize: 9, color: '#333', fontFamily: MONO, lineHeight: 1.5 }}>
              No clear FX-driven rotation signal
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 9, color: '#666', fontFamily: MONO }}>EXPORTERS</span>
              <span style={{ fontSize: 9, fontFamily: MONO, color: localSector === 'exporters' ? '#22c55e' : '#ef4444' }}>
                {localSector === 'exporters' ? 'BULLISH ↑' : 'BEARISH ↓'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 9, color: '#666', fontFamily: MONO }}>DOMESTICS</span>
              <span style={{ fontSize: 9, fontFamily: MONO, color: localSector === 'domestics' ? '#22c55e' : '#ef4444' }}>
                {localSector === 'domestics' ? 'BULLISH ↑' : 'BEARISH ↓'}
              </span>
            </div>
            <div style={{ fontSize: 9, color: '#333', fontFamily: MONO, lineHeight: 1.5 }}>
              {localSector === 'exporters'
                ? 'Weak yen favors Toyota, Sony, Nintendo'
                : 'Strong yen favors banks, domestic retail'}
            </div>
          </>
        )}
      </div>

      {/* ── S4: Structural Event Flags ───────────────────────────────────── */}
      <div style={SECTION}>
        <div style={LABEL}>STRUCTURAL FLAGS</div>
        {!hasFlags ? (
          <div style={{ fontSize: 9, color: '#333', fontFamily: MONO }}>No structural catalyst</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {bojFlag && (
              <div>
                <span style={{
                  display: 'inline-block',
                  fontSize: 9, padding: '2px 6px',
                  background: '#451a03', color: '#f59e0b',
                  fontFamily: MONO, border: '1px solid #f59e0b22',
                }}>
                  ⚡ BOJ EVENT
                </span>
                <div style={{ fontSize: 9, color: '#444', fontFamily: MONO, marginTop: 3, lineHeight: 1.4 }}>
                  Primary Japan equity driver
                </div>
              </div>
            )}
            {shuntoFlag && (
              <div>
                <span style={{
                  display: 'inline-block',
                  fontSize: 9, padding: '2px 6px',
                  background: '#451a03', color: '#f59e0b',
                  fontFamily: MONO, border: '1px solid #f59e0b22',
                }}>
                  ⚡ SHUNTO
                </span>
                <div style={{ fontSize: 9, color: '#444', fontFamily: MONO, marginTop: 3, lineHeight: 1.4 }}>
                  Wage → BOJ → Yen → Equity chain
                </div>
              </div>
            )}
            {tseReformFlag && (
              <div>
                <span style={{
                  display: 'inline-block',
                  fontSize: 9, padding: '2px 6px',
                  background: '#0c1a3e', color: '#3b82f6',
                  fontFamily: MONO, border: '1px solid #3b82f622',
                }}>
                  ⚡ TSE REFORM
                </span>
                <div style={{ fontSize: 9, color: '#444', fontFamily: MONO, marginTop: 3, lineHeight: 1.4 }}>
                  Governance catalyst — winner/loser split
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── S5: Foreign Flow Signal ──────────────────────────────────────── */}
      <div style={{ ...SECTION, borderBottom: 'none', flex: 1 }}>
        <div style={LABEL}>FOREIGN FLOW</div>
        {foreignFlowDirection == null ? (
          <div style={{ fontSize: 9, color: '#333', fontFamily: MONO }}>Awaiting analysis…</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
              <span style={{
                fontSize: 9, padding: '2px 6px',
                background: `${ffColor}18`, color: ffColor,
                fontFamily: MONO, letterSpacing: '0.08em',
                border: `1px solid ${ffColor}33`,
              }}>
                {foreignFlowDirection.toUpperCase()}
              </span>
              {foreignFlowConviction != null && (
                <span style={{ fontSize: 10, color: '#666', fontFamily: MONO }}>
                  {foreignFlowConviction}/10
                </span>
              )}
            </div>
            {foreignFlowReasoning && (
              <div style={{
                fontSize: 11, color: '#888', fontFamily: SANS,
                lineHeight: 1.5, marginBottom: 5,
              }}>
                {foreignFlowReasoning}
              </div>
            )}
            {foreignFlowKeyDriver && (
              <span style={{
                display: 'inline-block',
                fontSize: 9, padding: '2px 6px',
                color: '#f59e0b88', fontFamily: MONO,
                border: '1px solid #f59e0b22',
              }}>
                {foreignFlowKeyDriver}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
