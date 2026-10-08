import type { EventClassification } from '../types';
import { extractText, postAnalyze } from './api';

export async function classifyEvent(
  eventText: string,
  asset: string
): Promise<EventClassification> {
  const response = await postAnalyze({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 60,
    system: 'Classify the news event. Respond only with JSON.',
    messages: [
      {
        role: 'user',
        content: `Event: ${eventText}\nAsset: ${asset}\n\nRespond ONLY with JSON:\n{"event_type":"geopolitical|central_bank|data_release|corporate|commodity_supply|risk_off|other","severity":"low|medium|high|extreme","primary_asset_class":"forex|commodity|equity|rates","directional_clarity":"clear|ambiguous|contradictory"}`,
      },
    ],
  }, AbortSignal.timeout(30_000));

  if (!response.ok) throw new Error(`Classification failed: ${response.status}`);

  const text = extractText(await response.json(), 'Classification');

  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(cleaned) as EventClassification;
}
