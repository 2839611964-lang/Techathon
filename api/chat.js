import { marieInstructions, parseOpenAIError, requireApiKey } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const key = requireApiKey(res);
  if (!key) return;
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-12) : [];
  if (!messages.length) return res.status(400).json({ error: '缺少消息内容' });
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_TEXT_MODEL || 'gpt-5.5',
        instructions: marieInstructions,
        input: messages.map(({ role, text }) => ({ role: role === 'assistant' ? 'assistant' : 'user', content: text })),
        max_output_tokens: 600,
      }),
    });
    if (!response.ok) return res.status(response.status).json({ error: await parseOpenAIError(response) });
    const data = await response.json();
    return res.status(200).json({ text: data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text || '我听见了，我们继续。' });
  } catch (error) {
    return res.status(500).json({ error: `请求失败：${error.message}` });
  }
}
