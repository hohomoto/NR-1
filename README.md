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

## Project Layout

```text
client/    React app and UI components
server/    Express API, news aggregation, Anthropic proxy, IB integration
pipeline/  Historical dataset builder for NN training
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

By default, the app can run with synthetic weights. It can also retrain locally from accumulated labeled outcomes stored in the server dataset.

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

The generated live training dataset file at `server/data/training_dataset.json` is intentionally git-ignored so local runs and labels do not get committed by default.

## Notes

- This is a research project, not a production trading system.
- No API keys are committed to the repository; `.env` is ignored.
- The repository currently does not include an automated test suite.
