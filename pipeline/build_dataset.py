"""
NR-1 Historical Data Pipeline
Pulls GDELT news events + Yahoo Finance prices → training_dataset.json
No API keys required. Run from inside the pipeline/ directory.
"""

import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree as ET

import pandas as pd
import requests
import yfinance as yf
from gdeltdoc import GdeltDoc, Filters

# ─── Constants ────────────────────────────────────────────────────────────────

ASSET_ENCODING = {'NQ': 0, 'ES': 1, 'WTI': 2, 'NKY': 3, 'TOPIX': 4, 'EWJ': 5}

TICKER_MAP = {'NQ': 'NQ=F', 'ES': 'ES=F', 'WTI': 'CL=F',
              'NKY': '^N225', 'TOPIX': '^TOPX', 'EWJ': 'EWJ'}

ASSET_KEYWORDS = {
    'NQ': [
        'nasdaq', 'tech stocks', 'nvidia', 'apple', 'microsoft',
        'semiconductor', 'rate hike', 'rate cut', 'technology sector',
    ],
    'ES': [
        'S&P', 'stock market', 'Wall Street', 'equities', 'recession',
        'GDP', 'federal reserve', 'FOMC', 'inflation', 'CPI', 'NFP',
        'unemployment', 'earnings', 'treasury', 'banking crisis',
    ],
    'WTI': [
        'oil', 'crude', 'petroleum', 'OPEC', 'Iran', 'Saudi Arabia',
        'Russia oil', 'energy', 'barrel', 'oil production', 'oil supply',
    ],
    'NKY': [
        'Nikkei', 'Japanese stocks', 'Japan equity', 'TSE', 'Tokyo Stock Exchange',
        'Japan market', 'BOJ', 'Bank of Japan', 'yen policy', 'Nikkei 225',
        'Japanese shares', 'Japan rally', 'Japan selloff', 'Topix',
    ],
    'TOPIX': [
        'TOPIX', 'Tokyo stock', 'Japanese equities', 'TSE reform',
        'corporate governance Japan', 'Japan buyback', 'foreign investors Japan',
        'JPX', 'Japan index', 'Nikkei broad',
    ],
    'EWJ': [
        'Japan ETF', 'EWJ', 'iShares Japan', 'Japan fund',
        'Japan exposure', 'hedged Japan', 'Japan allocation',
    ],
}

EVENT_TYPE_ENCODING = {
    'geopolitical':     0,
    'central_bank':     1,
    'data_release':     2,
    'corporate':        3,
    'commodity_supply': 4,
    'risk_off':         5,
    'other':            6,
}

# Multi-word phrases — more specific, less likely to 404 on GDELT
GDELT_QUERIES = [
    {
        'event_type': 'geopolitical',
        'keywords': [
            'military strike', 'armed conflict', 'Iran sanctions',
            'Russia Ukraine war', 'Middle East conflict', 'oil embargo',
        ],
    },
    {
        'event_type': 'central_bank',
        'keywords': [
            'Federal Reserve rate', 'FOMC decision', 'Fed rate hike',
            'Fed rate cut', 'monetary policy',
        ],
    },
    {
        'event_type': 'data_release',
        'keywords': [
            'GDP growth report', 'jobs report NFP',
            'inflation report CPI', 'earnings report',
        ],
    },
    {
        'event_type': 'commodity_supply',
        'keywords': [
            'OPEC production cut', 'oil supply disruption',
            'crude oil inventory', 'energy crisis',
        ],
    },
    {
        'event_type': 'risk_off',
        'keywords': ['financial crisis', 'recession fears', 'bank collapse'],
    },
    # ── Japan-specific queries ─────────────────────────────────────────────────
    {
        'event_type': 'central_bank',
        'keywords': [
            'Bank of Japan policy', 'BOJ interest rate', 'BOJ yield curve control',
        ],
    },
    {
        'event_type': 'data_release',
        'keywords': [
            'Japan economic growth', 'Japan inflation data',
            'Japan GDP report', 'Japan corporate earnings',
        ],
    },
    {
        'event_type': 'geopolitical',
        'keywords': [
            'Japanese yen dollar', 'Japan US trade', 'Japan China relations',
        ],
    },
    {
        'event_type': 'other',
        'keywords': [
            'Nikkei stock market', 'Tokyo Stock Exchange', 'Japan foreign investment',
        ],
    },
]

# ─── Japan RSS feeds ──────────────────────────────────────────────────────────
# Supplements GDELT with English-language Japanese financial news.
# RSS feeds only carry the last 2–4 weeks of articles, so they contribute
# recent examples rather than deep historical data.

RSS_FEEDS_JAPAN = [
    {
        'url':    'https://www.japantimes.co.jp/feed/',
        'source': 'Japan Times',
    },
    {
        'url':    'https://www3.nhk.or.jp/nhkworld/en/news/feeds/',
        'source': 'NHK World',
    },
    {
        'url':    'https://japannews.net/feed/',
        'source': 'Japan News',          # Yomiuri Shimbun English edition
    },
]

# Simple keyword → event_type classifier for RSS titles (no GDELT metadata)
_RSS_EVENT_RULES: list[tuple[list[str], str]] = [
    (['boj', 'bank of japan', 'yield curve control', 'monetary policy',
      'interest rate', 'rate hike', 'rate cut', 'boj governor'],  'central_bank'),
    (['gdp', 'inflation', 'cpi', 'unemployment', 'jobs', 'trade data',
      'earnings', 'tankan', 'pmi', 'industrial output'],           'data_release'),
    (['war', 'sanctions', 'military', 'conflict', 'ukraine', 'taiwan',
      'trade war', 'tariff', 'geopolit', 'china japan', 'japan us'], 'geopolitical'),
    (['crisis', 'crash', 'recession', 'collapse', 'default',
      'bank run', 'financial shock'],                               'risk_off'),
]

def infer_event_type_rss(title: str) -> str:
    t = title.lower()
    for keywords, etype in _RSS_EVENT_RULES:
        if any(kw in t for kw in keywords):
            return etype
    return 'other'


def pull_rss_events() -> list[dict]:
    """Fetch Japan RSS feeds and return articles in GDELT-compatible dict format."""
    results = []
    for feed in RSS_FEEDS_JAPAN:
        try:
            resp = requests.get(
                feed['url'], timeout=10,
                headers={'User-Agent': 'NR-1-pipeline/1.0'},
            )
            resp.raise_for_status()
            root  = ET.fromstring(resp.content)
            items = root.findall('.//item')
            count = 0
            for item in items:
                title_el = item.find('title')
                date_el  = item.find('pubDate')
                if title_el is None or date_el is None:
                    continue
                title    = (title_el.text or '').strip()
                date_str = (date_el.text or '').strip()
                if not title or not date_str:
                    continue
                try:
                    dt       = parsedate_to_datetime(date_str)
                    seendate = dt.astimezone(timezone.utc).replace(tzinfo=None).isoformat() + 'Z'
                except Exception:
                    continue
                results.append({
                    'title':      title,
                    'seendate':   seendate,
                    'event_type': infer_event_type_rss(title),
                    'tone':       None,
                    'source':     f"rss_{feed['source'].lower().replace(' ', '_')}",
                    '_id_prefix': 'rss',
                })
                count += 1
            print(f"  → {feed['source']}: {count} articles")
        except Exception as e:
            print(f"  → {feed['source']}: failed ({e}), skipping")
    return results


# ─── Date helpers ─────────────────────────────────────────────────────────────

NOW_UTC        = datetime.now(timezone.utc).replace(tzinfo=None)
CUTOFF_OLD     = datetime(2024, 1, 1)
CUTOFF_RECENT  = NOW_UTC - timedelta(days=8)   # need 7 days of price history


def is_valid_date(dt: datetime) -> bool:
    """Return True if the article date is usable for 1W outcome labelling."""
    if dt > NOW_UTC:
        return False                 # future date
    if dt > CUTOFF_RECENT:
        return False                 # too recent — outcome price not available yet
    if dt < CUTOFF_OLD:
        return False                 # too old
    return True


# ─── Step 1: Pull GDELT events ─────────────────────────────────────────────────

def pull_gdelt_events() -> list[dict]:
    gd = GdeltDoc()
    all_articles = []

    end_date   = CUTOFF_RECENT                          # articles must be at least 8 days old
    start_date = max(CUTOFF_OLD, NOW_UTC - timedelta(days=90))

    for query in GDELT_QUERIES:
        for keyword in query['keywords']:
            try:
                f = Filters(
                    start_date  = start_date.strftime('%Y-%m-%d'),
                    end_date    = end_date.strftime('%Y-%m-%d'),
                    num_records = 100,
                    keyword     = keyword,
                )
                articles = gd.article_search(f)
                if articles is not None and not articles.empty:
                    articles['event_type'] = query['event_type']
                    all_articles.append(articles)
                    print(f"  → '{keyword}': {len(articles)} articles")
                else:
                    print(f"  → '{keyword}': 0 articles")
            except Exception as e:
                print(f"  → '{keyword}': failed ({e}), skipping")
            time.sleep(0.5)

    if not all_articles:
        return []

    combined = pd.concat(all_articles, ignore_index=True)
    combined = combined.drop_duplicates(subset=['title'])
    return combined.to_dict('records')


# ─── Step 2: Assign asset ──────────────────────────────────────────────────────

def assign_asset(title: str) -> str | None:
    title_lower = title.lower()
    scores: dict[str, int] = {}
    for asset, keywords in ASSET_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw.lower() in title_lower)
        if score > 0:
            scores[asset] = score
    if not scores:
        return None
    return max(scores, key=lambda k: scores[k])


# ─── Step 3: Yahoo Finance price fetch ────────────────────────────────────────

def get_price(ticker: str, date: datetime, offset_days: int = 0) -> float | None:
    target = date + timedelta(days=offset_days)

    # Guard: don't request prices for future dates or last 24 hours
    if target >= NOW_UTC - timedelta(hours=24):
        return None

    try:
        start = (target - timedelta(days=3)).strftime('%Y-%m-%d')
        end   = (target + timedelta(days=4)).strftime('%Y-%m-%d')

        tk   = yf.Ticker(ticker)
        data = tk.history(start=start, end=end, auto_adjust=True)

        # TOPIX fallback: ^TOPX has limited YF data — proxy with ^N225
        if (data is None or data.empty) and ticker == '^TOPX':
            tk   = yf.Ticker('^N225')
            data = tk.history(start=start, end=end, auto_adjust=True)

        if data is None or data.empty:
            return None

        data.index = data.index.tz_localize(None) if data.index.tzinfo else data.index
        idx = int(abs(data.index - pd.Timestamp(target)).argmin())
        return float(data['Close'].iloc[idx])
    except Exception:
        return None


# ─── Step 4: Feature encoding helpers ─────────────────────────────────────────

def encode_session(dt: datetime) -> int:
    h = dt.hour
    if 0 <= h < 8:  return 0   # Asia
    if 8 <= h < 16: return 1   # London
    return 2                    # New York


def encode_volatility(tone: float | None) -> int:
    if tone is None: return 1
    if tone < -5:   return 2   # high
    if tone > 2:    return 0   # low
    return 1                   # medium


def assign_bin(move_pct: float) -> int:
    if move_pct < -2.5: return 0
    if move_pct < -1.5: return 1
    if move_pct < -0.5: return 2
    if move_pct <  0.5: return 3
    if move_pct <  1.5: return 4
    if move_pct <  2.5: return 5
    return 6


# ─── Step 5: Main pipeline ────────────────────────────────────────────────────

def main() -> None:
    import resource
    resource.setrlimit(resource.RLIMIT_NOFILE, (4096, 4096))

    print("NR-1 Data Pipeline")
    print("==================")
    print(f"  Window: {CUTOFF_OLD.date()} → {CUTOFF_RECENT.date()}")

    # ── 1. Pull GDELT + RSS ────────────────────────────────────────────────────
    print("\n[1/5] Pulling GDELT events...")
    raw_events = pull_gdelt_events()
    print(f"  Total raw GDELT: {len(raw_events)} events")

    print("\n  Pulling Japan RSS feeds...")
    rss_events = pull_rss_events()
    print(f"  Total raw RSS: {len(rss_events)} events")

    raw_events = raw_events + rss_events
    print(f"  Combined: {len(raw_events)} events")

    # ── 2. Date filter + asset assignment ─────────────────────────────────────
    print("\n[2/5] Filtering dates and assigning assets...")
    matched: list[dict] = []
    skipped_date  = 0
    skipped_asset = 0

    for ev in raw_events:
        # Parse date
        try:
            raw_date = ev.get('seendate') or ev.get('publishdate')
            pub_date = pd.to_datetime(raw_date).to_pydatetime().replace(tzinfo=None)
        except Exception:
            skipped_date += 1
            continue

        if not is_valid_date(pub_date):
            skipped_date += 1
            continue

        ev['pub_date_parsed'] = pub_date

        # Assign asset
        asset = assign_asset(ev.get('title', ''))
        if not asset:
            skipped_asset += 1
            continue

        ev['asset'] = asset
        matched.append(ev)

    print(f"  → {len(matched)} matched, {skipped_date} skipped (date), {skipped_asset} skipped (no keyword)")

    # ── 3. Yahoo Finance prices ────────────────────────────────────────────────
    print("\n[3/5] Pulling Yahoo Finance prices...")
    examples:        list[dict] = []
    skipped_no_price = 0

    for i, ev in enumerate(matched):
        if i % 20 == 0:
            print(f"  → {i}/{len(matched)} processed...")

        pub_date = ev['pub_date_parsed']
        ticker   = TICKER_MAP.get(ev['asset'])
        if not ticker:
            skipped_no_price += 1
            continue

        asset = ev['asset']
        topix_proxy = False

        price_at_run = get_price(ticker, pub_date, 0)
        time.sleep(0.25)
        price_1w     = get_price(ticker, pub_date, 7)
        time.sleep(0.25)

        # Flag if TOPIX fell back to ^N225 proxy (get_price does the fallback internally)
        if asset == 'TOPIX' and price_at_run is not None:
            topix_proxy = True

        if price_at_run is None or price_1w is None:
            skipped_no_price += 1
            continue

        move_pct   = (price_1w - price_at_run) / price_at_run * 100
        actual_bin = assign_bin(move_pct)
        tone_raw   = ev.get('tone')
        tone_val   = float(tone_raw) if tone_raw is not None else None

        id_prefix = ev.get('_id_prefix', 'gdelt')
        example: dict = {
            'id':                f"{id_prefix}_{uuid.uuid4().hex[:12]}",
            'timestamp':         pub_date.isoformat() + 'Z',
            'asset':             asset,
            'timeframe':         '1W',
            'timeframe_minutes': 10080,
            'volatility_regime': ['low', 'medium', 'high'][encode_volatility(tone_val)],
            'event_text':        ev.get('title', ''),
            'event_type_encoded': EVENT_TYPE_ENCODING.get(ev.get('event_type', 'other'), 6),
            'asset_encoded':     ASSET_ENCODING.get(asset, 0),
            'session':           encode_session(pub_date),
            'day_of_week':       pub_date.weekday(),
            'price_at_run':      round(price_at_run, 5),
            'price_at_outcome':  round(price_1w, 5),
            'actual_move_pct':   round(move_pct, 4),
            'actual_bin':        actual_bin,
            'signal_direction':  None,
            'signal_confidence': None,
            'nn_predicted_bins': None,
            'agent_directions':  None,
            'outcome_captured':  True,
            'outcome_timestamp': (pub_date + timedelta(days=7)).isoformat() + 'Z',
            'source':            ev.get('source', 'gdelt_historical'),
        }
        if topix_proxy:
            example['topix_proxy'] = True
        examples.append(example)

    print(f"  → {len(examples)} valid examples, {skipped_no_price} skipped (no price)")
    us_assets    = ['NQ', 'ES', 'WTI']
    japan_assets = ['NKY', 'TOPIX', 'EWJ']
    us_counts    = {a: sum(1 for e in examples if e['asset'] == a) for a in us_assets}
    japan_counts = {a: sum(1 for e in examples if e['asset'] == a) for a in japan_assets}
    print(f"  → US assets:    NQ: {us_counts['NQ']}, ES: {us_counts['ES']}, WTI: {us_counts['WTI']}")
    print(f"  → Japan assets: NKY: {japan_counts['NKY']}, TOPIX: {japan_counts['TOPIX']}, EWJ: {japan_counts['EWJ']}")

    # ── 4. Encoding already done above ────────────────────────────────────────
    print("\n[4/5] Feature encoding complete.")

    # ── 5. Save + merge ────────────────────────────────────────────────────────
    print("\n[5/5] Saving dataset...")

    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir   = os.path.abspath(os.path.join(script_dir, '..', 'server', 'data'))
    os.makedirs(data_dir, exist_ok=True)

    hist_path = os.path.join(data_dir, 'training_dataset_historical.json')
    live_path = os.path.join(data_dir, 'training_dataset.json')

    # Write historical-only file
    with open(hist_path, 'w') as f:
        json.dump(examples, f, indent=2)
        f.flush()
        os.fsync(f.fileno())

    # Merge with existing live dataset, dedup by id
    live_examples: list[dict] = []
    if os.path.exists(live_path):
        try:
            with open(live_path) as f:
                live_examples = json.load(f)
        except Exception:
            live_examples = []

    seen_ids: set[str] = set()
    merged:   list[dict] = []
    for ex in live_examples + examples:
        if ex['id'] not in seen_ids:
            seen_ids.add(ex['id'])
            merged.append(ex)

    with open(live_path, 'w') as f:
        json.dump(merged, f, indent=2)
        f.flush()
        os.fsync(f.fileno())

    # ── Summary ────────────────────────────────────────────────────────────────
    bin_counts:   dict[str, int] = {str(i): 0 for i in range(7)}
    asset_counts: dict[str, int] = {}
    event_counts: dict[str, int] = {}

    for ex in examples:
        bin_counts[str(ex['actual_bin'])] += 1
        asset_counts[ex['asset']]              = asset_counts.get(ex['asset'], 0) + 1

    for ev in matched:
        et = ev.get('event_type', 'other')
        event_counts[et] = event_counts.get(et, 0) + 1

    japan_total = sum(asset_counts.get(a, 0) for a in ['NKY', 'TOPIX', 'EWJ'])
    us_total    = sum(asset_counts.get(a, 0) for a in ['NQ', 'ES', 'WTI'])

    summary = {
        'total_examples': len(merged),
        'historical':     len(examples),
        'live':           len(live_examples),
        'by_asset':       asset_counts,
        'by_event_type':  event_counts,
        'by_bin':         bin_counts,
        'by_region': {
            'japan': japan_total,
            'us':    us_total,
        },
        'date_range': {
            'start': min(e['timestamp'] for e in examples) if examples else None,
            'end':   max(e['timestamp'] for e in examples) if examples else None,
        },
    }

    summary_path = os.path.join(script_dir, 'dataset_summary.json')
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)
        f.flush()
        os.fsync(f.fileno())

    print(f"  → {hist_path}")
    print(f"  → {live_path}")
    print(f"  → {summary_path}")
    print(f"\n  Historical: {len(examples)} examples")
    print(f"  Merged with {len(live_examples)} live examples")
    print(f"  Total dataset: {len(merged)} examples")

    # Bin distribution
    total = len(examples)
    if total > 0:
        print("\nBin distribution:")
        labels = ['<-2.5%', '-2.5→-1.5%', '-1.5→-0.5%', '-0.5→+0.5%',
                  '+0.5→+1.5%', '+1.5→+2.5%', '>+2.5%']
        for i in range(7):
            count = bin_counts[str(i)]
            pct   = count / total * 100
            bar   = '█' * int(pct / 2)
            warn  = ' ⚠ IMBALANCED' if pct < 5 else ''
            print(f"  bin {i} {labels[i]:>14}: {count:>4} ({pct:5.1f}%) {bar}{warn}")

    print("\nDone.")
    print("==================")
    print("Next: open NR-1 — it auto-retrains when it detects 50+ new labeled examples.")


if __name__ == '__main__':
    main()
