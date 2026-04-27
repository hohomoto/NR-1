import type { Analogue } from '../types';

export async function runPatternAgent(
  eventText: string,
  asset: string,
  timeframe: string
): Promise<Analogue[]> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      system:
        'You are a market historian with encyclopedic knowledge of how news events have historically moved financial markets. When given a news event and asset, retrieve the most relevant historical analogues from your knowledge.',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `News event: ${eventText}
Asset: ${asset}
Timeframe: ${timeframe}

Return ONLY a JSON object, no markdown, no explanation:
{"analogues":[{"date":"string","event":"string","asset":"string","outcome":"bullish|bearish|neutral","magnitude":"string","notes":"string"}]}

Return up to 3 analogues, most relevant first.`,
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Pattern agent failed: ${response.status}`);

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Pattern agent returned empty response');

  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return parsed.analogues as Analogue[];
}
