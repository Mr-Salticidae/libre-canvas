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

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** 文本转语音：POST /audio/speech，返回音频 dataURL */
export async function generateSpeech(
  p: Provider,
  model: string,
  input: string,
  voice: string,
): Promise<string> {
  const res = await fetch(`${base(p)}/audio/speech`, {
    method: 'POST',
    headers: headers(p),
    body: JSON.stringify({ model, input, voice: voice || 'alloy' }),
  })
  if (!res.ok) throw new Error(await readError(res))
  const blob = await res.blob()
  if (blob.type.includes('json')) {
    throw new Error(`接口返回了 JSON 而不是音频：${(await blob.text()).slice(0, 200)}`)
  }
  return blobToDataURL(blob)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 文生视频：POST /videos（OpenAI 异步任务流，轮询直到完成后拉取内容）。
 * 兼容部分提供商直接同步返回 data[0].url / data[0].b64_json 的写法。
 */
export async function generateVideo(
  p: Provider,
  model: string,
  prompt: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const res = await fetch(`${base(p)}/videos`, {
    method: 'POST',
    headers: headers(p),
    body: JSON.stringify({ model, prompt }),
  })
  if (!res.ok) throw new Error(await readError(res))
  let job = await res.json()

  // 同步风格：直接给结果
  const sync = job?.data?.[0]
  if (sync?.url || sync?.b64_json) {
    if (sync.b64_json) return `data:video/mp4;base64,${sync.b64_json}`
    return fetchMediaAsDataURL(sync.url as string)
  }

  // 异步任务风格：轮询
  const id = job?.id
  if (!id) throw new Error(`接口返回格式异常：${JSON.stringify(job).slice(0, 200)}`)
  const startedAt = Date.now()
  while (['queued', 'in_progress', 'processing', 'pending', 'running'].includes(job?.status)) {
    if (Date.now() - startedAt > 15 * 60_000) throw new Error('视频任务超时（15 分钟）')
    const pct = job?.progress != null ? ` ${job.progress}%` : ''
    onProgress?.(`视频生成中（${job.status}${pct}）…`)
    await sleep(5000)
    const poll = await fetch(`${base(p)}/videos/${id}`, { headers: headers(p) })
    if (!poll.ok) throw new Error(await readError(poll))
    job = await poll.json()
  }
  if (job?.status !== 'completed') {
    throw new Error(`视频任务失败：${job?.error?.message ?? job?.status ?? '未知状态'}`)
  }
  onProgress?.('下载视频…')
  const content = await fetch(`${base(p)}/videos/${id}/content`, { headers: headers(p) })
  if (!content.ok) throw new Error(await readError(content))
  return blobToDataURL(await content.blob())
}

async function fetchMediaAsDataURL(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载媒体失败：HTTP ${res.status}`)
  return blobToDataURL(await res.blob())
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
