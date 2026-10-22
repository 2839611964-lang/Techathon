export async function readJson(response, fallback = '服务暂时不可用') {
  const text = await response.text();
  if (!text.trim()) throw new Error(`${fallback}（服务器返回为空）`);
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${fallback}（服务器响应格式不正确）`); }
  if (!response.ok) throw new Error(data?.error || `${fallback}（${response.status}）`);
  return data;
}
