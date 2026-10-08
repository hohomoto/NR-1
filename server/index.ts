import dotenv from 'dotenv';
import { resolve } from 'path';
import { createApp } from './app.js';
import { ibGateway } from './ibGateway.js';
import { outcomeLogger } from './outcomeLogger.js';

// Load .env from either the server folder or the project root.
dotenv.config({ path: resolve(process.cwd(), '.env'),   override: true });
dotenv.config({ path: resolve(process.cwd(), '../.env'), override: true });

const PORT = Number(process.env.SERVER_PORT) || 3001;
// Loopback by default so the Anthropic proxy isn't reachable from the network.
const HOST = process.env.SERVER_HOST || '127.0.0.1';

const app = createApp({ outcomeLogging: true, requireAccessCode: false });

app.listen(PORT, HOST, () => {
  console.log(`NR-1 server running on http://${HOST}:${PORT}`);
});

// ─── Interactive Brokers ──────────────────────────────────────────────────────
// Connect on startup (non-blocking), then retry periodically if the gateway
// is started later or drops.
let ibConnecting = false;
async function ensureIbConnected(): Promise<void> {
  if (ibConnecting || ibGateway.isConnected()) return;
  ibConnecting = true;
  try { await ibGateway.connect(); } catch { /* logged inside */ } finally { ibConnecting = false; }
}
ensureIbConnected();
setInterval(ensureIbConnected, 5 * 60_000);

// ─── Outcome capture sweep ────────────────────────────────────────────────────
// Due outcomes are persisted in the dataset, so this also picks up anything that
// came due while the server was down.
const sweep = () => {
  outcomeLogger.captureDueOutcomes((asset) => ibGateway.getPrice(asset)).catch((err) => {
    console.error('[OutcomeLogger] Sweep error:', err);
  });
};
sweep();
setInterval(sweep, 60_000);

// Disconnect on exit
process.on('exit', () => ibGateway.disconnect());
process.on('SIGINT', () => { ibGateway.disconnect(); process.exit(0); });
process.on('SIGTERM', () => { ibGateway.disconnect(); process.exit(0); });
