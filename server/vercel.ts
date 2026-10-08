import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from './app.js';

// Vercel entry point, bundled by scripts/build-vercel.mjs into a single function.
// No IB connection or outcome logging here: functions are short-lived and the
// filesystem is read-only, so the dataset endpoints serve the committed history.
const app = createApp({ outcomeLogging: false, requireAccessCode: false });

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // Routing rewrites /api/<path> to this function and passes <path> as __nr1path,
  // so restore the original URL for Express in case the platform hands us /api.
  const url = new URL(req.url ?? '/', 'http://localhost');
  const original = url.searchParams.get('__nr1path');
  if (original !== null) {
    url.searchParams.delete('__nr1path');
    if (!url.pathname.startsWith('/api/')) url.pathname = `/api/${original}`;
    req.url = url.pathname + url.search;
  }
  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
