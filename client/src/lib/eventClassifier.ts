import type { EventClassification } from '../types';

export async function classifyEvent(
  eventText: string,
  asset: string
): Promise<EventClassification> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      system: 'Classify the news event. Respond only with JSON.',
      messages: [
        {
          role: 'user',
          content: `Event: ${eventText}\nAsset: ${asset}\n\nRespond ONLY with JSON:\n{"event_type":"geopolitical|central_bank|data_release|corporate|commodity_supply|risk_off|other","severity":"low|medium|high|extreme","primary_asset_class":"forex|commodity|equity|rates","directional_clarity":"clear|ambiguous|contradictory"}`,
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Classification failed: ${response.status}`);

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Classification returned empty response');

  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(cleaned) as EventClassification;
}
