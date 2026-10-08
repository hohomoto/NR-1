import { useState, useEffect } from 'react';
import { useNR1Store } from '../store/useNR1Store';
import type { DatasetStats } from '../types';

export function SessionSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const sessionHistory = useNR1Store((s) => s.sessionHistory);
  const activeHistoryId = useNR1Store((s) => s.activeHistoryId);
  const loadHistoryEntry = useNR1Store((s) => s.loadHistoryEntry);
  const nnWeightSource = useNR1Store((s) => s.nnWeightSource);
  const nnTrainedExamples = useNR1Store((s) => s.nnTrainedExamples);
  const analysisComplete = useNR1Store((s) => s.analysisComplete);

  const [stats, setStats] = useState<DatasetStats>({ total: 0, withOutcomes: 0, readyToTrain: false });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/dataset/stats');
        if (res.ok) setStats(await res.json() as DatasetStats);
      } catch { /* server may not be ready yet */ }
    };
    fetchStats();
  }, [analysisComplete]); // refresh after each run completes

  // Retraining happens once 50 new labels exist beyond what the current weights saw
  // (or at the first 50 when still untrained).
  const MILESTONE = 50;
  const newLabels = nnWeightSource === 'trained'
    ? Math.max(stats.withOutcomes - nnTrainedExamples, 0)
    : stats.withOutcomes;
  const towardNext = Math.min(newLabels, MILESTONE);
  const progressPct = towardNext / MILESTONE * 100;

  const directionColor = (dir: string | undefined) => {
    if (dir === 'bullish') return 'bg-green';
    if (dir === 'bearish') return 'bg-red';
    return 'bg-blue';
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  if (collapsed) {
    return (
      <div className="w-8 bg-panel border-r border-border flex flex-col items-center pt-2 shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="text-text-dim hover:text-text-muted text-xs p-1"
          title="Expand sidebar"
        >
          ▶
        </button>
        <div className="mt-2 text-text-dim text-xs font-mono">
          {sessionHistory.length}
        </div>
      </div>
    );
  }

  return (
    <div className="w-[220px] bg-panel border-r border-border flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-sans text-text-muted uppercase tracking-wider">
          Session
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-text-dim hover:text-text-muted text-xs"
        >
          ◀
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessionHistory.length === 0 && (
          <div className="p-3 text-xs text-text-dim font-sans">
            No runs yet
          </div>
        )}
        {sessionHistory.map((entry) => (
          <button
            key={entry.id}
            onClick={() => loadHistoryEntry(entry.id)}
            className={`w-full text-left px-3 py-2 border-b border-border hover:bg-background transition-colors ${
              activeHistoryId === entry.id ? 'bg-background' : ''
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-text-primary">
                {entry.asset}
              </span>
              <span className={`w-2 h-2 rounded-full ${directionColor(entry.finalSignal?.direction)}`} />
              <span className="font-mono text-xs text-text-dim ml-auto">
                {formatTime(entry.timestamp)}
              </span>
            </div>
            <div className="text-xs text-text-dim font-sans truncate">
              {entry.eventText.slice(0, 40)}
            </div>
            {entry.priceAtRun != null && (
              <div className="text-[10px] font-mono text-text-dim mt-0.5">
                @ {entry.priceAtRun.toFixed(5)}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Training data stats panel */}
      <div className="border-t border-border px-3 py-2 shrink-0">
        <div className="text-[9px] font-mono text-text-dim uppercase tracking-widest mb-2">
          Training Data
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-text-dim">outcomes logged</span>
            <span className="text-text-muted">{stats.withOutcomes}</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-text-dim">total runs</span>
            <span className="text-text-muted">{stats.total}</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-text-dim">nn weights</span>
            <span className={nnWeightSource === 'trained' ? 'text-green' : 'text-amber opacity-60'}>
              {nnWeightSource === 'trained'
                ? `trained · ${nnTrainedExamples}`
                : 'synthetic'}
            </span>
          </div>
        </div>
        {/* Progress to next retrain milestone */}
        <div className="mt-2">
          <div className="flex justify-between text-[9px] font-mono text-text-dim mb-1">
            <span>next retrain</span>
            <span>{towardNext}/{MILESTONE}</span>
          </div>
          <div className="w-full h-px bg-border-bright rounded-full overflow-hidden">
            <div
              className="h-full bg-amber opacity-60 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
