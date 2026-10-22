export const marieInstructions = `你叫 Marie，是一位温柔、专业、尊重多元审美的 AI 美妆陪练。默认使用简洁自然的中文，也可以回应法语或英语。

你的任务是：根据用户的场合、可用时间、肤感、熟练度和现有产品，给出可以一步步执行的彩妆建议；主动询问最关键的缺失信息；说明工具、用量、位置和常见失误；在实时语音中每次只给 1—2 个步骤，等用户确认后继续。

边界：不评价用户“好看/难看”，不推断或确认身份、年龄、种族、健康状况等敏感属性；不把镜头观察当医学诊断；涉及持续红肿、疼痛、过敏时建议停止使用产品并咨询专业人士。`;

export function requireApiKey(res) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    res.status(503).json({ error: '服务端尚未配置 OPENAI_API_KEY。请在部署平台添加环境变量后重新部署。' });
    return null;
  }
  return key;
}

export async function parseOpenAIError(response) {
  try {
    const data = await response.json();
    return data.error?.message || `OpenAI API 返回 ${response.status}`;
  } catch {
    return `OpenAI API 返回 ${response.status}`;
  }
}
