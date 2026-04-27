import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { SessionSidebar } from './components/SessionSidebar';
import { EventInput } from './components/EventInput';
import { AgentSwarm } from './components/AgentSwarm';
import { JapanIntelPanel } from './components/JapanIntelPanel';
import { NewsPanel } from './components/NewsPanel';
import { SignalPanel } from './components/SignalPanel';
import { ProbabilityHistogram } from './components/ProbabilityHistogram';
import { ConsensusBreakdown } from './components/ConsensusBreakdown';
import { useNR1Store } from './store/useNR1Store';
import { ALL_ASSETS } from './types';

export default function App() {
  const runAnalysis  = useNR1Store((s) => s.runAnalysis);
  const clearRun     = useNR1Store((s) => s.clearRun);
  const isRunning    = useNR1Store((s) => s.isRunning);
  const eventText    = useNR1Store((s) => s.eventText);
  const asset        = useNR1Store((s) => s.asset);
  const setAsset     = useNR1Store((s) => s.setAsset);
  const fetchNews    = useNR1Store((s) => s.fetchNews);
  const isJapanAsset = useNR1Store((s) => s.isJapanAsset);

  // Kick off news polling on mount
  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 60_000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!isRunning && eventText.trim()) runAnalysis();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        clearRun();
      }
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
        e.preventDefault();
        const idx = (ALL_ASSETS as readonly string[]).indexOf(asset);
        const next = (idx + 1) % ALL_ASSETS.length;
        setAsset(ALL_ASSETS[next] as string);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [runAnalysis, clearRun, isRunning, eventText, asset, setAsset]);

  return (
    <div className="h-screen w-screen bg-background text-text-primary flex flex-col overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <SessionSidebar />
        <div className="flex flex-1 overflow-hidden">
          {/* Event Input */}
          <div className="w-[260px] shrink-0 border-r border-border overflow-y-auto">
            <EventInput />
          </div>

          {/* Agent Swarm */}
          <div className="flex-1 min-w-0 border-r border-border overflow-y-auto">
            <AgentSwarm />
          </div>

          {/* Japan Intel Panel — visible only for NKY, TOPIX, EWJ */}
          {isJapanAsset && <JapanIntelPanel />}

          {/* News Feed */}
          <div className="w-[260px] shrink-0 border-r border-border overflow-hidden flex flex-col">
            <NewsPanel />
          </div>

          {/* Signal Output */}
          <div className="w-[260px] shrink-0 overflow-y-auto">
            <SignalPanel />
            <ProbabilityHistogram />
            <ConsensusBreakdown />
          </div>
        </div>
      </div>
    </div>
  );
}
