const ACCESS_STORAGE_KEY = 'nr1_access_code';
const ACCESS_HEADER = 'x-nr1-access-code';

export function getAccessCode(): string | null {
  try { return localStorage.getItem(ACCESS_STORAGE_KEY); } catch { return null; }
}

export function setAccessCode(code: string | null): void {
  try {
    if (code) localStorage.setItem(ACCESS_STORAGE_KEY, code);
    else localStorage.removeItem(ACCESS_STORAGE_KEY);
  } catch { /* storage unavailable — code lives for this page only */ }
}

let onAccessDenied: (() => void) | null = null;

export function setAccessDeniedHandler(fn: () => void): void {
  onAccessDenied = fn;
}

// All Anthropic calls go through the server proxy with the shared access code attached.
export async function postAnalyze(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const code = getAccessCode();
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(code ? { [ACCESS_HEADER]: code } : {}),
    },
    signal,
    body: JSON.stringify(body),
  });
  if (res.status === 401) onAccessDenied?.();
  return res;
}

type ContentBlock = { type: string; text?: string };

// Read the reply by block type: Sonnet 5.5 can lead with a (possibly empty) thinking block.
export function extractText(data: { content?: ContentBlock[]; stop_reason?: string }, label: string): string {
  if (data.stop_reason === 'refusal') throw new Error(`${label} declined by the model`);
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('');
  if (!text) throw new Error(`${label} returned empty response`);
  return text;
}

export async function verifyAccessCode(code: string): Promise<boolean> {
  const res = await fetch('/api/access', { method: 'POST', headers: { [ACCESS_HEADER]: code } });
  return res.ok;
}
