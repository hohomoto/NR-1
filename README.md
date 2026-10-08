# NR-1

NR-1 is an LLM-assisted news-to-market-signal terminal for discretionary trading research.

It combines:
- a React terminal-style dashboard
- a TypeScript/Express API layer
- a multi-agent Anthropic workflow
- a lightweight TensorFlow.js probability model
- an optional Python pipeline for building historical training data

## What It Does

Paste a macro, geopolitical, central-bank, or market headline into the UI and NR-1 will:

1. classify the event
2. run a parallel swarm of specialized market personas
3. retrieve historical analogues
4. generate a 7-bin movement probability distribution
5. aggregate everything into a final directional signal

The current interface is centered on:
- US futures: `NQ`, `ES`, `WTI`
- Japan-sensitive assets: `NKY`, `TOPIX`, `EWJ`

For Japan assets, the app adds a dedicated panel for USD/JPY, yield proxy, carry-risk, and structural flags such as BOJ- or TSE-related catalysts.

## Stack

- Frontend: React 19, Vite, TypeScript, Zustand, Tailwind, TensorFlow.js
- Backend: Express, TypeScript
- LLM provider: Anthropic Messages API
- Optional market data: Interactive Brokers via `@stoqey/ib`
- Optional dataset pipeline: Python, GDELT, Yahoo Finance

## Prerequisites

- Node.js 18+
- npm
- Anthropic API key

Optional:
- Interactive Brokers Gateway or TWS for live price snapshots and outcome logging
- Python 3.9+ for the dataset pipeline

## Setup

```bash
npm run install:all
cp .env.example .env
```

Then add your Anthropic key to `.env`:

```bash
ANTHROPIC_API_KEY=your_key_here
SERVER_PORT=3001
```

## Run

```bash
npm run dev
```

This starts:
- client: `http://localhost:5173`
- server: `http://localhost:3001`

## Deploy to Vercel

The repo deploys as a static client plus one serverless function (`scripts/build-vercel.mjs` writes a Build Output API bundle; `vercel.json` points Vercel at it).

```bash
vercel link
vercel env add ANTHROPIC_API_KEY production
vercel deploy --prod
```

Without `ANTHROPIC_API_KEY` the dashboard loads but analysis stays disabled. Anyone with the URL can run analyses on your key; the proxy only accepts NR-1's own models and request sizes and rate-limits per IP (`NR1_RATE_LIMIT`, requests per 10 minutes, default 150), and a spend limit on the Anthropic workspace caps the rest. To restrict access, also set `NR1_ACCESS_CODE`: viewers then enter that code once before they can run analyses.

On Vercel there is no Interactive Brokers connection and no outcome logging (functions are short-lived and the filesystem is read-only); the neural net trains in each browser from the committed historical dataset.

## Project Layout

```text
client/    React app and UI components
server/    Express API, news aggregation, Anthropic proxy, IB integration
pipeline/  Historical dataset builder for NN training
scripts/   Vercel build
```

## Architecture

### Agent Swarm

The current swarm uses 9 roles:
- Momentum Trader
- Macro Fund
- Retail Crowd
- Market Maker
- Risk Officer
- Central Bank Watcher
- Options Trader
- Algorithmic/Quant Fund
- Bond Market

Each agent returns:
- `direction`
- `conviction`
- `reasoning`
- `key_factors`

If the vote split is too conflicted, the run can escalate to Claude Opus for a second pass.

### Pattern Agent

A separate prompt asks for up to 3 historical analogues relevant to the same event and asset.

### Neural Network Layer

The frontend includes a small TensorFlow.js model that outputs a 7-bin probability distribution from strongly simplified encoded features.

By default, the app runs with untrained (randomly initialised) weights. Once 50+ labeled examples exist it trains in the browser, and retrains each time 50 more arrive. Features are encoded identically to the pipeline (event type comes from the classifier's label).

### Signal Aggregation

The final signal combines:
- weighted agent votes
- weighted conviction
- neural net peak probability
- event classification context

## Live Data

The backend currently exposes:
- `/api/news` for filtered RSS aggregation
- `/api/vix` for live VIX from Yahoo Finance
- `/api/jgb` for a US10Y-based Japan yield proxy
- `/api/price/:symbol` for Interactive Brokers price snapshots

If IB is not connected, the app still runs, but live price-dependent features degrade gracefully.

## Dataset Pipeline

The optional pipeline in [pipeline/README_PIPELINE.md](pipeline/README_PIPELINE.md) builds historical examples from GDELT, Japan RSS feeds, and Yahoo Finance.

The generated live training dataset file at `server/data/training_dataset.json` is intentionally git-ignored so local runs and labels do not get committed by default. Until it exists, the server serves the committed `training_dataset_historical.json`.

When IB is connected, each run records its entry price and an outcome due time. A sweep every minute captures due outcomes, including ones that came due while the server was down; outcomes more than 5% of the horizon late (minimum 1h) are marked missed rather than labeled with a stale price.

## Notes

- This is a research project, not a production trading system.
- No API keys are committed to the repository; `.env` is ignored.
- The repository currently does not include an automated test suite.
