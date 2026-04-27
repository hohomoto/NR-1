import { useNR1Store } from '../store/useNR1Store';
import { ASSETS, TIMEFRAMES } from '../types';

const ASSET_GROUPS = [
  { label: 'US',     assets: ASSETS.Futures },
  { label: 'Japan',  assets: ASSETS.Japan   },
] as const;
import { useEffect, useState } from 'react';

export function TopBar() {
  const asset = useNR1Store((s) => s.asset);
  const setAsset = useNR1Store((s) => s.setAsset);
  const timeframe = useNR1Store((s) => s.timeframe);
  const setTimeframe = useNR1Store((s) => s.setTimeframe);
  const vixValue = useNR1Store((s) => s.vixValue);
  const vixTimestamp = useNR1Store((s) => s.vixTimestamp);
  const vixStale = useNR1Store((s) => s.vixStale);
  const setVix = useNR1Store((s) => s.setVix);

  const [ibConnected, setIbConnected] = useState(false);

  useEffect(() => {
    const fetchVix = async () => {
      try {
        const res = await fetch('/api/vix');
        if (res.ok) {
          const data = await res.json();
          setVix(data.value, data.timestamp, data.stale ?? false);
        }
      } catch { /* keep last value */ }
    };
    fetchVix();
    const interval = setInterval(fetchVix, 60000);
    return () => clearInterval(interval);
  }, [setVix]);

  useEffect(() => {
    const checkIB = async () => {
      try {
        const res = await fetch('/api/price/NQ');
        if (res.ok) {
          const data = await res.json() as { connected: boolean };
          setIbConnected(data.connected === true);
        } else {
          setIbConnected(false);
        }
      } catch {
        setIbConnected(false);
      }
    };
    checkIB();
    const interval = setInterval(checkIB, 30000);
    return () => clearInterval(interval);
  }, []);

  // kept for Tab-cycle keyboard shortcut in App.tsx
  const allAssets = [...ASSETS.Futures, ...ASSETS.Japan].map((a) => ({ name: a }));

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  return (
    <div className="h-12 bg-panel border-b border-border flex items-center px-4 shrink-0">
      <span className="font-mono text-amber font-bold text-lg tracking-wide mr-8">
        NR-1
      </span>

      <div className="flex-1 flex items-center justify-center gap-4">
        <div className="flex items-center bg-background border border-border rounded-sm overflow-hidden">
          {ASSET_GROUPS.map((group, gi) => (
            <div key={group.label} className="flex items-center">
              {gi > 0 && <div className="w-px h-4 bg-border-bright mx-0.5" />}
              {group.assets.map((a) => (
                <button
                  key={a}
                  onClick={() => setAsset(a)}
                  className={`px-3 py-1 text-xs font-mono transition-colors ${
                    asset === a
                      ? 'bg-amber-dim text-amber'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center bg-background border border-border rounded-sm overflow-hidden">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 text-xs font-mono transition-colors ${
                timeframe === tf
                  ? 'bg-amber-dim text-amber'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs font-mono">
        {/* IB Gateway status */}
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${ibConnected ? 'bg-green' : 'bg-red'}`} />
          <span className={ibConnected ? 'text-green' : 'text-text-dim'}>
            {ibConnected ? 'IB CONNECTED' : 'IB OFFLINE'}
          </span>
        </div>

        {/* VIX */}
        <div className="flex items-center gap-2">
          {vixValue !== null && (
            <>
              <span className="text-text-dim">VIX</span>
              <span className={`font-bold ${vixValue > 25 ? 'text-red' : vixValue > 18 ? 'text-amber' : 'text-green'}`}>
                {vixValue.toFixed(2)}
              </span>
            </>
          )}
          {vixTimestamp && (
            <span className="text-text-dim">{formatTime(vixTimestamp)}</span>
          )}
          <span className={`w-2 h-2 rounded-full ${vixStale ? 'bg-red' : 'bg-green animate-pulse'}`} />
        </div>
      </div>
    </div>
  );
}
