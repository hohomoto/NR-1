# NR-1 Data Pipeline

Builds a historical training dataset for the NR-1 neural network using GDELT news events and Yahoo Finance price data. Completely free — no API keys required.

---

## What it does

1. **Pulls GDELT** — searches the last 90 days of global news for 5 event categories (geopolitical, central bank, data release, commodity supply, risk-off)
2. **Assigns assets** — keyword-matches each headline to the most relevant asset (EUR/USD, WTI, SPX, etc.)
3. **Fetches prices** — pulls entry price (day of event) and outcome price (7 days later) from Yahoo Finance
4. **Encodes features** — converts everything to the 5-feature format NR-1's NN expects
5. **Merges** — deduplicates and merges with any existing live runs in `training_dataset.json`

---

## Prerequisites

- Python 3.9+
- Run from inside the `pipeline/` directory

---

## Setup

```bash
cd pipeline
pip install -r requirements.txt
```

---

## Run

```bash
python build_dataset.py
```

Takes **5–15 minutes** depending on network speed. Yahoo Finance requests are rate-limited to avoid blocks.

---

## Output

| File | Description |
|------|-------------|
| `server/data/training_dataset_historical.json` | Historical examples only (GDELT-sourced) |
| `server/data/training_dataset.json` | **Merged** live + historical (this is what NR-1 reads) |
| `pipeline/dataset_summary.json` | Stats — counts by asset, bin distribution, date range |

---

## Re-running

Safe to run multiple times. New examples are merged by ID, never duplicated.

---

## Bin labels

The pipeline uses the same 7-bin outcome scheme as NR-1:

| Bin | Move |
|-----|------|
| 0 | < −2.5% |
| 1 | −2.5% to −1.5% |
| 2 | −1.5% to −0.5% |
| 3 | −0.5% to +0.5% (flat) |
| 4 | +0.5% to +1.5% |
| 5 | +1.5% to +2.5% |
| 6 | > +2.5% |

The script warns if any bin has < 5% representation — imbalanced data degrades NN accuracy.

---

## GDELT limitation

Free tier returns up to 100 articles per keyword query, covering the last 90 days only. Run monthly to accumulate data over time.

---

## Next step

Once the dataset is built, open NR-1 in the browser. It automatically detects when 50+ new labeled examples are available and triggers a retraining cycle. After retraining, the NN weight source switches from **SYNTHETIC** to **TRAINED** and the confidence weighting shifts from 95%/5% to 70%/30% in favour of the trained model.
