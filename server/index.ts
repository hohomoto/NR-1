import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { XMLParser } from 'fast-xml-parser';
import { ibGateway } from './ibGateway.js';
import { outcomeLogger } from './outcomeLogger.js';

// Load .env from either the server folder or the project root.
dotenv.config({ path: resolve(process.cwd(), '.env'),   override: true });
dotenv.config({ path: resolve(process.cwd(), '../.env'), override: true });

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

app.use(cors());
app.use(express.json());

let lastVix: { value: number; timestamp: string } | null = null;

// ─── JGB / US10Y yield cache ───────────────────────────────────────────────
interface JgbData { yield: number | null; change: number | null; proxy: string; timestamp: string; error?: boolean }
let jgbCache: { data: JgbData; fetchedAt: number } | null = null;
const JGB_CACHE_TTL = 5 * 60_000;

// ─── News feed cache ──────────────────────────────────────────────────────────
interface NewsItem {
  id: string;
  title: string;
  source: 'Google' | 'FT' | 'Investing' | 'NHK' | 'Nikkei' | 'JapanTimes' | 'ReutersJP';
  pubDate: string;
  link: string;
  summary: string;
}

let newsCache: { items: NewsItem[]; fetchedAt: number } | null = null;
const NEWS_CACHE_TTL = 30_000;

const RSS_FEEDS: { url: string; source: NewsItem['source'] }[] = [
  // ── World / macro ────────────────────────────────────────────────────────
  { url: 'https://news.google.com/rss/search?q=forex+Fed+ECB+rate+inflation+markets&hl=en-US&gl=US&ceid=US:en', source: 'Google' },
  { url: 'https://news.google.com/rss/search?q=geopolitics+sanctions+war+trade+tariff&hl=en-US&gl=US&ceid=US:en', source: 'Google' },
  { url: 'https://www.ft.com/rss/home/uk',                  source: 'FT'        },
  { url: 'https://www.investing.com/rss/news_301.rss',      source: 'Investing' },
  // ── Japan (English) ──────────────────────────────────────────────────────
  { url: 'https://www3.nhk.or.jp/nhkworld/en/news/feeds/business/', source: 'NHK'       },
  { url: 'https://www3.nhk.or.jp/nhkworld/en/news/feeds/',          source: 'NHK'       },
  { url: 'https://www.japantimes.co.jp/feed/',                      source: 'JapanTimes'},
  { url: 'https://asia.nikkei.com/rss/feed/nar',                    source: 'Nikkei'    },
  { url: 'https://feeds.reuters.com/reuters/businessNews',          source: 'ReutersJP' },
];

// ─── News relevance filter ────────────────────────────────────────────────────
const MACRO_KEYWORDS = ['Fed', 'Federal Reserve', 'FOMC', 'ECB', 'BOJ', 'Bank of Japan', 'interest rate', 'rate hike', 'rate cut', 'inflation', 'CPI', 'GDP', 'NFP', 'jobs report', 'unemployment', 'earnings', 'recession', 'yield', 'treasury', 'bond', 'monetary policy', 'fiscal policy', 'tariff', 'trade war', 'sanctions', 'oil', 'crude', 'OPEC', 'energy', 'gold', 'dollar', 'yen', 'euro', 'sterling', 'equity', 'stock market', 'S&P', 'Nasdaq', 'Nikkei', 'TOPIX', 'hedge fund', 'central bank', 'quantitative easing', 'balance sheet', 'liquidity', 'credit', 'debt ceiling', 'IMF', 'World Bank', 'G7', 'G20'];
const GEO_KEYWORDS   = ['war', 'conflict', 'military', 'strike', 'missile', 'nuclear', 'sanctions', 'Iran', 'Russia', 'Ukraine', 'China', 'Taiwan', 'North Korea', 'Israel', 'Gaza', 'Middle East', 'South China Sea', 'NATO', 'coup', 'invasion', 'attack', 'troops', 'weapons', 'diplomacy', 'treaty', 'embargo', 'blockade'];
const JAPAN_KEYWORDS = ['Japan', 'Japanese', 'Nikkei', 'TOPIX', 'BOJ', 'Tokyo', 'TSE', 'yen', 'JPY', 'Kishida', 'Ueda', 'Abenomics', 'SoftBank', 'Toyota', 'Sony', 'Nintendo', 'Mitsubishi', 'Nomura', 'Osaka'];
const EXCLUDE_KEYWORDS = ['sports', 'entertainment', 'celebrity', 'recipe', 'lifestyle', 'fashion', 'travel', 'weather', 'horoscope', 'music', 'movie', 'TV show', 'gaming'];
const ALL_INCLUDE = [...MACRO_KEYWORDS, ...GEO_KEYWORDS, ...JAPAN_KEYWORDS];

function isRelevant(item: NewsItem): boolean {
  const text = (item.title + ' ' + item.summary).toLowerCase();
  if (EXCLUDE_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()))) return false;
  return ALL_INCLUDE.some((kw) => text.includes(kw.toLowerCase()));
}

function stripHtml(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 280);
}

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

async function fetchFeed(url: string, source: NewsItem['source']): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 NR1-News-Reader/1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, isArray: (n) => n === 'item' });
  const parsed = parser.parse(xml);
  const rawItems: Record<string, unknown>[] =
    parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  return rawItems.map((item) => {
    const title   = stripHtml(String(item.title   ?? ''));
    const link    = String(item.link    ?? item.guid ?? '');
    const pubDate = String(item.pubDate ?? item.updated ?? item.published ?? '');
    const summary = stripHtml(String(item.description ?? item.summary ?? item['content:encoded'] ?? ''));
    return { id: hashId(title + link), title, source, pubDate, link, summary };
  }).filter((i) => i.title.length > 0);
}

// ─── Live news feed ───────────────────────────────────────────────────────────
app.get('/api/news', async (_req, res) => {
  if (newsCache && Date.now() - newsCache.fetchedAt < NEWS_CACHE_TTL) {
    res.json(newsCache.items);
    return;
  }
  try {
    const results = await Promise.allSettled(
      RSS_FEEDS.map((f) => fetchFeed(f.url, f.source))
    );
    const all: NewsItem[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value);
    }
    // Filter to financial / macro / geopolitical relevance
    const relevant = all.filter(isRelevant);
    // Deduplicate by normalised title
    const seen = new Set<string>();
    const deduped = relevant.filter((i) => {
      const key = i.title.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Sort newest first
    deduped.sort((a, b) => {
      const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return tb - ta;
    });
    const items = deduped.slice(0, 30);
    newsCache = { items, fetchedAt: Date.now() };
    res.json(items);
  } catch (err) {
    console.error('[news] fetch error:', err);
    res.json(newsCache?.items ?? []);
  }
});

// ─── Anthropic proxy ─────────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { messages, model, system, max_tokens } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 1024,
        system: system || undefined,
        messages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      res.status(response.status).json({ error });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Anthropic API error:', err);
    res.status(500).json({ error: 'Failed to call Anthropic API' });
  }
});

// ─── VIX ─────────────────────────────────────────────────────────────────────
app.get('/api/vix', async (_req, res) => {
  try {
    const response = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX'
    );

    if (!response.ok) {
      if (lastVix) { res.json({ ...lastVix, stale: true }); return; }
      res.status(502).json({ error: 'Failed to fetch VIX' });
      return;
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const price = result?.meta?.regularMarketPrice;
    const timestamp = new Date().toISOString();

    if (price != null) {
      lastVix = { value: price, timestamp };
      res.json({ value: price, timestamp, stale: false });
    } else if (lastVix) {
      res.json({ ...lastVix, stale: true });
    } else {
      res.status(502).json({ error: 'VIX data unavailable' });
    }
  } catch (err) {
    console.error('VIX fetch error:', err);
    if (lastVix) { res.json({ ...lastVix, stale: true }); return; }
    res.status(502).json({ error: 'Failed to fetch VIX' });
  }
});

// ─── JGB 10Y yield proxy ──────────────────────────────────────────────────────
app.get('/api/jgb', async (_req, res) => {
  if (jgbCache && Date.now() - jgbCache.fetchedAt < JGB_CACHE_TTL) {
    res.json(jgbCache.data);
    return;
  }
  try {
    const response = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d',
      { headers: { 'User-Agent': 'Mozilla/5.0 NR1/1.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error(`Yahoo returned ${response.status}`);
    const data = await response.json();
    const result0   = data.chart.result[0];
    const current   = result0.meta.regularMarketPrice as number;
    const closes    = result0.indicators.quote[0].close as (number | null)[];
    const validPrev = closes.filter((c: number | null) => c != null);
    const prev      = validPrev[validPrev.length - 2] ?? validPrev[0] ?? current;
    const change    = parseFloat((current - prev).toFixed(3));
    const result: JgbData = { yield: current, change, proxy: 'US10Y', timestamp: new Date().toISOString() };
    jgbCache = { data: result, fetchedAt: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('[jgb] fetch error:', err);
    if (jgbCache) { res.json({ ...jgbCache.data, stale: true }); return; }
    res.json({ yield: null, change: null, proxy: 'US10Y', timestamp: new Date().toISOString(), error: true });
  }
});

// ─── IB price snapshot ────────────────────────────────────────────────────────
app.get('/api/price/:symbol', async (req, res) => {
  const symbol = decodeURIComponent(req.params.symbol);
  try {
    if (!ibGateway.isConnected()) {
      res.json({ connected: false, bid: null, ask: null, mid: null, timestamp: new Date().toISOString() });
      return;
    }
    const price = await ibGateway.getPrice(symbol);
    res.json(price);
  } catch (err) {
    console.error('[IB] getPrice error:', err);
    res.json({ connected: false, bid: null, ask: null, mid: null, timestamp: new Date().toISOString() });
  }
});

// ─── Run logging ──────────────────────────────────────────────────────────────
app.post('/api/run/start', async (req, res) => {
  const {
    asset, timeframe, timeframe_minutes, volatility_regime,
    event_text, event_type_encoded, asset_encoded, session,
    day_of_week, signal_direction, signal_confidence,
    nn_predicted_bins, agent_directions,
  } = req.body as {
    asset: string; timeframe: string; timeframe_minutes: number;
    volatility_regime: string; event_text: string;
    event_type_encoded: number; asset_encoded: number;
    session: number; day_of_week: number;
    signal_direction: string; signal_confidence: number;
    nn_predicted_bins: number[]; agent_directions: Record<string, string>;
  };

  let price_at_run: number | null = null;
  let id = '';

  console.log(`[run/start] POST received — asset=${asset} tf=${timeframe}`);

  try {
    if (ibGateway.isConnected()) {
      const priceData = await ibGateway.getPrice(asset);
      price_at_run = priceData.mid;
      console.log(`[run/start] IB price for ${asset}: ${price_at_run}`);
    } else {
      console.log(`[run/start] IB not connected — logging without price`);
    }

    id = outcomeLogger.logRun({
      timestamp: new Date().toISOString(),
      asset, timeframe, timeframe_minutes,
      volatility_regime, event_text,
      event_type_encoded, asset_encoded,
      session, day_of_week,
      price_at_run,
      signal_direction, signal_confidence,
      nn_predicted_bins, agent_directions,
    });

    if (price_at_run !== null) {
      outcomeLogger.scheduleOutcomeCapture(id, asset, timeframe_minutes, price_at_run);
    }

    console.log(`[run/start] Logged id=${id} price=${price_at_run}`);
    res.json({ logged: true, price_at_run, id });
  } catch (err) {
    console.error('[run/start] error:', err);
    res.json({ logged: false, price_at_run: null, id: '' });
  }
});

// ─── Dataset endpoints ────────────────────────────────────────────────────────
app.get('/api/dataset/stats', async (_req, res) => {
  try {
    const dataset = await outcomeLogger.getDataset();
    // Count any example with a resolved actual_bin — includes GDELT historical
    // examples where outcome_captured may be false but actual_bin is populated.
    const withOutcomes = dataset.filter(
      (e: { actual_bin?: number | null }) => e.actual_bin !== null && e.actual_bin !== undefined
    ).length;
    const readyToTrain = withOutcomes >= 50; // removed % 50 === 0 gate that was blocking retrain
    const stats = { total: dataset.length, withOutcomes, readyToTrain };
    console.log(`[dataset/stats] total=${stats.total} withOutcomes=${withOutcomes} readyToTrain=${readyToTrain}`);
    res.json(stats);
  } catch (err) {
    console.error('[dataset/stats] error:', err);
    res.status(500).json({ error: 'Failed to read dataset stats' });
  }
});

app.get('/api/dataset', async (_req, res) => {
  try {
    const dataset = await outcomeLogger.getDataset();
    res.json(dataset);
  } catch (err) {
    console.error('[dataset] error:', err);
    res.status(500).json({ error: 'Failed to read dataset' });
  }
});

app.listen(PORT, () => {
  console.log(`NR-1 server running on port ${PORT}`);
});
