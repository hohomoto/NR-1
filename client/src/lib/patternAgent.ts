import type { Analogue } from '../types';
import { extractText, postAnalyze } from './api';

export async function runPatternAgent(
  eventText: string,
  asset: string,
  timeframe: string
): Promise<Analogue[]> {
  const response = await postAnalyze({
    model: 'claude-sonnet-5-5',
    system:
      'You are a market historian with encyclopedic knowledge of how news events have historically moved financial markets. When given a news event and asset, retrieve the most relevant historical analogues from your knowledge.',
    max_tokens: 2048,
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
  }, AbortSignal.timeout(30_000));

  if (!response.ok) throw new Error(`Pattern agent failed: ${response.status}`);

  const text = extractText(await response.json(), 'Pattern agent');

  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return parsed.analogues as Analogue[];
}
