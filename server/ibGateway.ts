import { IBApi, EventName, Contract, SecType } from '@stoqey/ib';

export interface PriceData {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  timestamp: string;
  connected: boolean;
}

// Tick type constants
const TICK_BID   = 1;
const TICK_ASK   = 2;
const TICK_LAST  = 4;
const TICK_CLOSE = 9; // previous close — useful for indices when market is closed

// Monthly front month (energy futures: WTI, BRENT, NATGAS).
// WTI/Brent expire ~20th of the month BEFORE delivery.
// So on March 26: April has expired → front month = May (+2 from current month).
// On March 10: April hasn't expired → front month = April (+1).
function monthlyFront(): string {
  const now   = new Date();
  let year    = now.getUTCFullYear();
  let month   = now.getUTCMonth() + 1; // 1-12
  const extra = now.getUTCDate() >= 20 ? 2 : 1;
  month += extra;
  while (month > 12) { month -= 12; year += 1; }
  return `${year}${String(month).padStart(2, '0')}`;
}

// Quarterly front month (NQ, ES, etc. — Mar/Jun/Sep/Dec).
// Rolls forward 10 days before expiry (3rd Friday of contract month).
function quarterlyFront(): string {
  const now   = new Date();
  const month = now.getUTCMonth() + 1; // 1-12
  const day   = now.getUTCDate();
  const year  = now.getUTCFullYear();
  const qMonths = [3, 6, 9, 12];
  // Find the current or next quarterly month
  for (const qm of qMonths) {
    if (month < qm || (month === qm && day < 15)) {
      return `${year}${String(qm).padStart(2, '0')}`;
    }
  }
  return `${year + 1}03`; // roll to March next year
}

// Built per request so a long-running server rolls to the next contract month.
function contractFor(asset: string): Contract | undefined {
  const FM  = monthlyFront();
  const FMQ = quarterlyFront();
  const CONTRACT_MAP: Record<string, Contract> = {
    'NQ':      { symbol: 'NQ',    secType: SecType.FUT,  currency: 'USD', exchange: 'CME',      lastTradeDateOrContractMonth: FMQ },
    'ES':      { symbol: 'ES',    secType: SecType.FUT,  currency: 'USD', exchange: 'CME',      lastTradeDateOrContractMonth: FMQ },
    'WTI':     { symbol: 'CL',    secType: SecType.FUT,  currency: 'USD', exchange: 'NYMEX',    lastTradeDateOrContractMonth: FM  },
    'NKY':     { symbol: 'NKY',   secType: SecType.IND,  currency: 'JPY', exchange: 'OSE' },
    'TOPIX':   { symbol: 'TOPIX', secType: SecType.IND,  currency: 'JPY', exchange: 'TSE' },
    'EWJ':     { symbol: 'EWJ',   secType: SecType.STK,  currency: 'USD', exchange: 'ARCA' },
    'USD/JPY': { symbol: 'USD',   secType: SecType.CASH, currency: 'JPY', exchange: 'IDEALPRO' },
  };
  return CONTRACT_MAP[asset];
}

class IBGatewayService {
  private api: IBApi | null = null;
  private connected = false;
  private connectedPort: number | null = null;
  private reqIdCounter = 1;

  private nextReqId(): number {
    return this.reqIdCounter++;
  }

  async connect(): Promise<void> {
    const attempts: { host: string; port: number }[] = [
      { host: 'localhost', port: 4002 },
      { host: '127.0.0.1', port: 4002 },
      { host: '::1',       port: 4002 },
      { host: 'localhost', port: 4001 },
    ];
    for (const { host, port } of attempts) {
      try {
        await this._tryConnect(host, port);
        this.connectedPort = port;
        console.log(`[IB] Connected on ${host}:${port}`);
        return;
      } catch {
        console.log(`[IB] ${host}:${port} unavailable, trying next...`);
      }
    }
    console.log('[IB] IB Gateway unreachable — all connection attempts failed');
  }

  private _tryConnect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const api = new IBApi({ clientId: 1, host, port });
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          api.disconnect();
          reject(new Error('Connection timeout'));
        }
      }, 10000);

      api.on(EventName.connected, () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        this.api = api;
        this.connected = true;
        api.on(EventName.disconnected, () => {
          console.log('[IB] Disconnected');
          this.connected = false;
          this.api = null;
        });
        // Post-connection error logger — filter informational codes
        api.on(EventName.error, (reqId: unknown, code: unknown, msg: unknown) => {
          const c = typeof code === 'number' ? code : -1;
          // IB informational / farm-connected codes — safe to ignore
          if ([2104, 2106, 2107, 2108, 2119, 2158].includes(c)) return;
          console.warn(`[IB] error reqId=${reqId} code=${code}: ${msg}`);
        });
        resolve();
      });

      // Pre-connection error handler — only reject on real errors, not info codes
      api.on(EventName.error, (err: unknown, code: unknown, _reqId: unknown) => {
        const c = typeof code === 'number' ? code : -1;
        // Ignore informational codes that IB fires on connect before the connected event
        if ([2104, 2106, 2107, 2108, 2119, 2158].includes(c)) return;
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        console.log(`[IB] ${host}:${port} rejected — code=${code} err=${err}`);
        reject(new Error(`IB error code=${code}`));
      });

      api.connect();
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectedPort(): number | null {
    return this.connectedPort;
  }

  getPrice(asset: string): Promise<PriceData> {
    const contract = contractFor(asset);
    console.log(`[IB] getPrice: ${asset} →`, JSON.stringify(contract));
    const api = this.api;
    if (!contract || !api || !this.connected) {
      return Promise.resolve({
        bid: null, ask: null, mid: null,
        timestamp: new Date().toISOString(),
        connected: false,
      });
    }

    return new Promise((resolve) => {
      const reqId = this.nextReqId();
      let bid: number | null = null;
      let ask: number | null = null;

      let last: number | null = null;

      // Snapshot requests self-cancel on IB side — do NOT call cancelMktData
      // after snapshot ends, it triggers error 300 flood.
      const cleanup = () => { /* no-op for snapshots */ };

      const resolvePrices = () => {
        const mid = bid !== null && ask !== null
          ? (bid + ask) / 2
          : (bid ?? ask ?? last); // fall back to LAST tick for indices
        resolve({ bid, ask, mid, timestamp: new Date().toISOString(), connected: true });
      };

      const onTickPrice = (rId: number, tickType: number, price: number) => {
        if (rId !== reqId) return;
        if (price === -1) return; // IB returns -1 for unavailable ticks
        if (tickType === TICK_BID)   bid  = price;
        if (tickType === TICK_ASK)   ask  = price;
        if (tickType === TICK_LAST)  last = price;
        if (tickType === TICK_CLOSE && last === null) last = price; // use close if no last
      };

      const removeListeners = () => {
        api.off(EventName.tickPrice,       onTickPrice);
        api.off(EventName.tickSnapshotEnd, onSnapshotEnd);
        api.off(EventName.error,           onError);
      };

      const onSnapshotEnd = (rId: number) => {
        if (rId !== reqId) return;
        clearTimeout(timer);
        removeListeners();
        cleanup();
        resolvePrices();
      };

      const timer = setTimeout(() => {
        removeListeners();
        cleanup();
        resolvePrices();
      }, 5000);

      const onError = (rId: number, code: number, message: string) => {
        if (rId !== reqId) return;
        console.warn(`[IB] Market data error for ${asset} (req ${reqId}): code=${code} — ${message}`);
      };

      api.on(EventName.tickPrice, onTickPrice);
      api.on(EventName.tickSnapshotEnd, onSnapshotEnd);
      api.on(EventName.error, onError);

      try {
        // Snapshot request — generic ticks not allowed with snapshot mode (IB error 321)
        // Default snapshot includes bid, ask, last, and close ticks
        api.reqMktData(reqId, contract, '', true, false);
      } catch (err) {
        clearTimeout(timer);
        api.off(EventName.tickPrice, onTickPrice);
        api.off(EventName.tickSnapshotEnd, onSnapshotEnd);
        console.error('[IB] reqMktData error:', err);
        resolve({ bid: null, ask: null, mid: null, timestamp: new Date().toISOString(), connected: false });
      }
    });
  }

  disconnect(): void {
    if (this.api) {
      try { this.api.disconnect(); } catch { /* ignore */ }
      this.api = null;
      this.connected = false;
    }
  }
}

export const ibGateway = new IBGatewayService();
