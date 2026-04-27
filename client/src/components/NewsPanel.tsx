import { useState } from 'react';
import { useNR1Store } from '../store/useNR1Store';
import type { NewsItem } from '../types';

type Tab    = 'WORLD' | 'JAPAN';
type Filter = 'ALL' | 'MACRO' | 'GEO';

// ── Japan source / keyword matcher ──────────────────────────────────────────
const JAPAN_SOURCES = new Set(['NHK', 'Nikkei', 'JapanTimes', 'ReutersJP']);

const JAPAN_KW = [
  'japan', 'japanese', 'nikkei', 'topix', 'boj', 'bank of japan',
  'tokyo', 'tse', ' yen', 'jpy', 'kishida', 'ueda', 'osaka',
  'sony', 'toyota', 'softbank', 'nintendo', 'panasonic',
  'mitsubishi', 'sumitomo', 'nomura', 'sbi', 'j-reit', 'abenomics',
];

function isJapan(item: NewsItem): boolean {
  if (JAPAN_SOURCES.has(item.source as string)) return true;
  const t = item.title.toLowerCase();
  return JAPAN_KW.some((kw) => t.includes(kw));
}

// ── Secondary filter matchers ────────────────────────────────────────────────
const MACRO_KW = ['fed', 'ecb', 'gdp', 'inflation', 'rate', 'cpi', 'nfp', 'fomc', 'treasury', 'yield', 'tariff', 'trade'];
const GEO_KW   = ['war', 'conflict', 'sanctions', 'military', 'strike', 'iran', 'russia', 'ukraine', 'china', 'taiwan', 'attack', 'nuclear'];

function matchesSecondary(item: NewsItem, filter: Filter): boolean {
  if (filter === 'ALL') return true;
  const text = item.title.toLowerCase();
  const kws  = filter === 'MACRO' ? MACRO_KW : GEO_KW;
  return kws.some((kw) => text.includes(kw));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(pubDate: string): string {
  if (!pubDate) return '';
  const diff = Date.now() - new Date(pubDate).getTime();
  if (isNaN(diff) || diff < 0) return '';
  const s = Math.floor(diff / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SOURCE_COLOR: Record<string, string> = {
  Google:     '#34d399',
  FT:         '#ec4899',
  Investing:  '#3b82f6',
  NHK:        '#ef4444',
  Nikkei:     '#3b82f6',
  JapanTimes: '#8b5cf6',
  ReutersJP:  '#f59e0b',
};

// ── Component ────────────────────────────────────────────────────────────────
export function NewsPanel() {
  const newsItems       = useNR1Store((s) => s.newsItems);
  const newsLastUpdated = useNR1Store((s) => s.newsLastUpdated);
  const setEventText    = useNR1Store((s) => s.setEventText);
  const setTimeframe    = useNR1Store((s) => s.setTimeframe);
  const setAsset        = useNR1Store((s) => s.setAsset);

  const [tab,    setTab]    = useState<Tab>('WORLD');
  const [filter, setFilter] = useState<Filter>('ALL');

  const isFresh = newsLastUpdated
    ? Date.now() - new Date(newsLastUpdated).getTime() < 60_000
    : false;

  const updatedLabel = newsLastUpdated
    ? new Date(newsLastUpdated).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    : '—';

  const visible = newsItems
    .filter((i) => (tab === 'JAPAN' ? isJapan(i) : !isJapan(i)))
    .filter((i) => matchesSecondary(i, filter));

  function handleItemClick(item: NewsItem) {
    const text = item.summary
      ? `${item.title}\n\n${item.summary}`
      : item.title;
    setEventText(text);
    setTimeframe('1W');
    if (tab === 'JAPAN') setAsset('NKY');

    // Flash the Run Analysis button
    const btns = document.querySelectorAll<HTMLButtonElement>('button');
    for (const btn of btns) {
      if (btn.textContent?.includes('RUN ANALYSIS') || btn.textContent?.includes('ANALYZING')) {
        btn.style.transition = 'filter 0.08s ease';
        btn.style.filter = 'brightness(2.5)';
        setTimeout(() => { btn.style.filter = ''; }, 650);
        break;
      }
    }
  }

  const tabBtn = (label: string, value: Tab) => (
    <button
      key={value}
      onClick={() => setTab(value)}
      className="font-mono"
      style={{
        fontSize: '9px',
        letterSpacing: '0.1em',
        color: tab === value ? '#f59e0b' : '#555',
        paddingBottom: '2px',
        background: 'none',
        border: 'none',
        borderBottom: tab === value ? '1px solid #f59e0b' : '1px solid transparent',
        cursor: 'pointer',
        transition: 'color 0.15s',
      }}
    >
      {label}
    </button>
  );

  const filterBtn = (value: Filter) => (
    <button
      key={value}
      onClick={() => setFilter(value)}
      className="font-mono"
      style={{
        fontSize: '9px',
        letterSpacing: '0.1em',
        color: filter === value ? '#f59e0b' : '#444',
        paddingBottom: '2px',
        background: 'none',
        border: 'none',
        borderBottom: filter === value ? '1px solid #f59e0b' : '1px solid transparent',
        cursor: 'pointer',
        transition: 'color 0.15s',
      }}
    >
      {value}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 shrink-0 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono font-bold" style={{ fontSize: '10px', color: '#f59e0b', letterSpacing: '0.12em' }}>
            LIVE FEED
          </span>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${isFresh ? 'bg-green animate-pulse' : 'bg-border'}`}
            />
            <span className="font-mono text-text-dim" style={{ fontSize: '9px' }}>
              {updatedLabel}
            </span>
          </div>
        </div>

        {/* Row 1 — primary tabs */}
        <div className="flex gap-3 mb-1.5">
          {tabBtn('🇯🇵 JAPAN', 'JAPAN')}
          {tabBtn('WORLD',    'WORLD')}
        </div>

        {/* Row 2 — secondary filters */}
        <div className="flex gap-3">
          {(['ALL', 'MACRO', 'GEO'] as Filter[]).map((f) => filterBtn(f))}
        </div>
      </div>

      {/* Feed list */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <div className="p-4 text-center text-text-dim font-sans" style={{ fontSize: '11px' }}>
            {newsItems.length === 0 ? 'Loading feed...' : 'No items match filter'}
          </div>
        )}
        {visible.map((item) => (
          <div
            key={item.id}
            onClick={() => handleItemClick(item)}
            className="px-3 py-2.5 cursor-pointer transition-colors"
            style={{
              borderBottom: '1px solid #111',
              background: 'transparent',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#1a1a1f'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            <div className="flex items-start justify-between gap-1.5 mb-0.5">
              <span
                className="font-mono shrink-0"
                style={{
                  fontSize: '9px',
                  color: SOURCE_COLOR[item.source] ?? '#888',
                  letterSpacing: '0.08em',
                }}
              >
                {item.source.toUpperCase()}
              </span>
              <span className="font-mono text-text-dim shrink-0" style={{ fontSize: '9px' }}>
                {timeAgo(item.pubDate)}
              </span>
            </div>
            <p
              className="font-sans text-text-primary leading-snug"
              style={{
                fontSize: '11px',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {item.title}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
