import type { Provider } from '../types'

function base(p: Provider): string {
  return p.baseURL.replace(/\/+$/, '')
}

function headers(p: Provider): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${p.apiKey}`,
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.text()
    return `HTTP ${res.status}: ${body.slice(0, 300)}`
  } catch {
    return `HTTP ${res.status}`
  }
}

/** 测试连通性：GET /models */
export async function testProvider(p: Provider): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${base(p)}/models`, { headers: headers(p) })
    if (!res.ok) return { ok: false, message: await readError(res) }
    const data = await res.json()
    const count = Array.isArray(data?.data) ? data.data.length : 0
    return { ok: true, message: `连接成功${count ? `，可用模型 ${count} 个` : ''}` }
  } catch (e) {
    return { ok: false, message: `请求失败（可能是 CORS 或网络问题）：${String(e)}` }
  }
}

/** 文生文：POST /chat/completions */
export async function generateText(p: Provider, model: string, prompt: string): Promise<string> {
  const res = await fetch(`${base(p)}/chat/completions`, {
    method: 'POST',
    headers: headers(p),
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(await readError(res))
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('接口返回格式异常：没有 choices[0].message.content')
  return text
}

/** 文生图：POST /images/generations，返回 dataURL 或 URL */
export async function generateImage(p: Provider, model: string, prompt: string): Promise<string> {
  const res = await fetch(`${base(p)}/images/generations`, {
    method: 'POST',
    headers: headers(p),
    body: JSON.stringify({ model, prompt, n: 1 }),
  })
  if (!res.ok) throw new Error(await readError(res))
  const data = await res.json()
  const item = data?.data?.[0]
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`
  if (item?.url) return item.url as string
  throw new Error('接口返回格式异常：没有 data[0].b64_json 或 data[0].url')
}
