import { marieInstructions, parseOpenAIError, requireApiKey } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const key = requireApiKey(res);
  if (!key) return;
  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': 'marie-demo-user',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1',
          instructions: marieInstructions,
          output_modalities: ['audio'],
          audio: {
            input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad' } },
            output: { voice: 'marin' },
          },
        },
      }),
    });
    if (!response.ok) return res.status(response.status).json({ error: await parseOpenAIError(response) });
    return res.status(200).json(await response.json());
  } catch (error) {
    return res.status(500).json({ error: `创建语音会话失败：${error.message}` });
  }
}
