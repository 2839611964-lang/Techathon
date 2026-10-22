import { parseOpenAIError, requireApiKey } from './_shared.js';

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const key = requireApiKey(res);
  if (!key) return;
  const image = req.body?.image;
  const lookTitle = String(req.body?.lookTitle || '当前妆容').slice(0, 80);
  const stepTitle = String(req.body?.stepTitle || '当前步骤').slice(0, 100);
  const stepPart = String(req.body?.stepPart || '').slice(0, 40);
  const stepDetail = String(req.body?.stepDetail || '').slice(0, 240);
  const stepRisk = String(req.body?.stepRisk || '').slice(0, 160);
  if (typeof image !== 'string' || !image.startsWith('data:image/')) return res.status(400).json({ error: '缺少有效的相机快照' });
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-5.5',
        input: [{ role: 'user', content: [
          { type: 'input_text', text: `你是 Marie，美妆陪练。用户正在跟练“${lookTitle}”，当前环节是“${stepPart}：${stepTitle}”。教程动作：${stepDetail}。常见失误：${stepRisk}。

只检查镜头中明确可见、与当前步骤直接相关的内容：位置是否正确、左右是否均衡、边界是否晕开、用量是否明显过多或不足、是否出现结块/飞粉/色块。先判断画面是否足以检查；看不清时不要猜，action 只写如何调整镜头。只给一个最优先、能立刻执行的动作。不要识别人物，不推断年龄、种族、性别、健康或其他敏感属性，不评价美丑，不做皮肤病诊断。` },
          { type: 'input_image', image_url: image, detail: 'high' },
        ]}],
        text: { format: { type: 'json_schema', name: 'makeup_feedback', strict: true, schema: {
          type: 'object', additionalProperties: false,
          properties: {
            summary: { type: 'string' }, region: { type: 'string' }, observation: { type: 'string' },
            action: { type: 'string' }, suggestions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
            lighting: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['summary', 'region', 'observation', 'action', 'suggestions', 'lighting', 'confidence'],
        } } },
        max_output_tokens: 400,
      }),
    });
    if (!response.ok) return res.status(response.status).json({ error: await parseOpenAIError(response) });
    const data = await response.json();
    const text = data.output_text || '';
    const cleaned = text.replace(/^```json\s*|\s*```$/g, '');
    let parsed;
    try { parsed = JSON.parse(cleaned); } catch { parsed = { summary: 'Marie 已完成观察', suggestions: [text], lighting: '' }; }
    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: `图像分析失败：${error.message}` });
  }
}
