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

async function fetchModelIds(p: Provider, query = ''): Promise<string[]> {
  const res = await fetch(`${base(p)}/models${query}`, { headers: headers(p) })
  if (!res.ok) throw new Error(await readError(res))
  const data = await res.json()
  return (Array.isArray(data?.data) ? data.data : [])
    .map((m: { id?: string }) => m?.id)
    .filter((id: unknown): id is string => typeof id === 'string')
}

/**
 * 拉取该提供商真实可用的模型列表：GET /models。
 * 硅基流动的 /models 默认只返回文本模型，图片/视频/音频模型必须带 ?type= 才列得出来。
 */
export async function listModels(p: Provider, mode?: string): Promise<string[]> {
  const ids = await fetchModelIds(p)
  if (/siliconflow\.(cn|com)/i.test(p.baseURL) && mode && mode !== 'text') {
    const type = mode === 'audio' ? 'audio' : mode === 'video' ? 'video' : 'image'
    try {
      ids.push(...(await fetchModelIds(p, `?type=${type}`)))
    } catch {
      // 分类查询失败就只用默认列表，不影响主流程
    }
  }
  return [...new Set(ids)].sort()
}

/** 文生文：POST /chat/completions。带参考图时按多模态 content 传入（视觉理解） */
export async function generateText(
  p: Provider,
  model: string,
  prompt: string,
  images: string[] = [],
): Promise<string> {
  const content =
    images.length > 0
      ? [
          { type: 'text', text: prompt },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ]
      : prompt
  const res = await fetch(`${base(p)}/chat/completions`, {
    method: 'POST',
    headers: headers(p),
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) throw new Error(await readError(res))
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('接口返回格式异常：没有 choices[0].message.content')
  return text
}

function dataURLToBlob(dataURL: string): Blob {
  const [head, b64] = dataURL.split(',')
  const mime = head.match(/data:(.*?)[;,]/)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

/** dataURL 直接转；远程 URL 先抓成 Blob（可能受对方 CORS 限制） */
async function srcToBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) return dataURLToBlob(src)
  const res = await fetch(src)
  if (!res.ok) throw new Error(`拉取图片失败：HTTP ${res.status}`)
  return res.blob()
}

async function parseImageResult(res: Response): Promise<string> {
  if (!res.ok) throw new Error(await readError(res))
  const data = await res.json()
  const item = data?.data?.[0]
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`
  if (item?.url) return item.url as string
  throw new Error('接口返回格式异常：没有 data[0].b64_json 或 data[0].url')
}

/** 以图生图：POST /images/edits（multipart），参考图 + 提示词 → 新图 */
export async function generateImageEdit(
  p: Provider,
  model: string,
  prompt: string,
  images: string[],
): Promise<string> {
  const fd = new FormData()
  fd.append('model', model)
  fd.append('prompt', prompt)
  const blobs = await Promise.all(images.map(srcToBlob))
  if (blobs.length === 1) {
    fd.append('image', blobs[0], 'ref-0.png')
  } else {
    blobs.forEach((b, i) => fd.append('image[]', b, `ref-${i}.png`))
  }
  const res = await fetch(`${base(p)}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.apiKey}` },
    body: fd,
  })
  return parseImageResult(res)
}

/** 蒙版局部重绘：POST /images/edits，mask 全透明处 = 允许重绘的区域 */
export async function generateImageInpaint(
  p: Provider,
  model: string,
  prompt: string,
  image: string,
  mask: string,
): Promise<string> {
  const fd = new FormData()
  fd.append('model', model)
  fd.append('prompt', prompt)
  fd.append('image', await srcToBlob(image), 'image.png')
  fd.append('mask', dataURLToBlob(mask), 'mask.png')
  const res = await fetch(`${base(p)}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.apiKey}` },
    body: fd,
  })
  return parseImageResult(res)
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

/** 视频生成的参考素材（画布卡片连线而来，src 一般是 dataURL） */
export interface VideoRefs {
  images?: string[]
  videos?: string[]
  audios?: string[]
}

/** 硅基流动文生视频：POST /video/submit 提交任务 + POST /video/status 轮询（非 OpenAI 规范）。首张参考图作为 i2v 首帧 */
async function generateVideoSiliconFlow(
  p: Provider,
  model: string,
  prompt: string,
  refs: VideoRefs = {},
  onProgress?: (msg: string) => void,
): Promise<string> {
  // 有参考图时必须用 I2V 模型，拿 T2V 的名字带 image 提交会被拒
  const hasImage = Boolean(refs.images?.length)
  const finalModel = hasImage ? model.replace(/-T2V-/i, '-I2V-') : model
  // image_size 是必填项，缺了会直接报错
  const body: Record<string, unknown> = {
    model: finalModel,
    prompt,
    image_size: '1280x720',
  }
  if (hasImage) body.image = refs.images![0]
  const res = await fetch(`${base(p)}/video/submit`, {
    method: 'POST',
    headers: headers(p),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readError(res))
  const submit = await res.json()
  const requestId = submit?.requestId
  if (!requestId) throw new Error(`接口返回格式异常：${JSON.stringify(submit).slice(0, 200)}`)

  const startedAt = Date.now()
  while (true) {
    if (Date.now() - startedAt > 15 * 60_000) throw new Error('视频任务超时（15 分钟）')
    await sleep(5000)
    const poll = await fetch(`${base(p)}/video/status`, {
      method: 'POST',
      headers: headers(p),
      body: JSON.stringify({ requestId }),
    })
    if (!poll.ok) throw new Error(await readError(poll))
    const job = await poll.json()
    if (job?.status === 'Succeed') {
      const url = job?.results?.videos?.[0]?.url
      if (!url) throw new Error(`任务完成但没有视频地址：${JSON.stringify(job).slice(0, 200)}`)
      onProgress?.('下载视频…')
      // 结果链接约 1 小时过期，尽量抓下来存成 dataURL；CDN 不放行 CORS 时退回原始链接
      try {
        return await fetchMediaAsDataURL(url)
      } catch {
        return url as string
      }
    }
    if (job?.status === 'Failed') {
      throw new Error(`视频任务失败：${job?.reason ?? '未知原因'}`)
    }
    onProgress?.(`视频生成中（${job?.status ?? '排队中'}）…`)
  }
}

/** 火山方舟（Seedance）文生视频：POST /contents/generations/tasks 建任务 + GET 同路径轮询（非 OpenAI 规范）。参考素材以 role=reference_image/video/audio 传入，提示词里可用「图片1」「视频1」「音频1」按连线顺序指代 */
async function generateVideoArk(
  p: Provider,
  model: string,
  prompt: string,
  refs: VideoRefs = {},
  onProgress?: (msg: string) => void,
): Promise<string> {
  const content: unknown[] = [
    { type: 'text', text: prompt },
    ...(refs.images ?? []).map((url) => ({ type: 'image_url', image_url: { url }, role: 'reference_image' })),
    ...(refs.videos ?? []).map((url) => ({ type: 'video_url', video_url: { url }, role: 'reference_video' })),
    ...(refs.audios ?? []).map((url) => ({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })),
  ]
  const body: Record<string, unknown> = { model, content }
  if (/seedance-2/i.test(model)) body.generate_audio = true
  const res = await fetch(`${base(p)}/contents/generations/tasks`, {
    method: 'POST',
    headers: headers(p),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readError(res))
  const created = await res.json()
  const id = created?.id
  if (!id) throw new Error(`接口返回格式异常：${JSON.stringify(created).slice(0, 200)}`)

  const startedAt = Date.now()
  while (true) {
    if (Date.now() - startedAt > 15 * 60_000) throw new Error('视频任务超时（15 分钟）')
    await sleep(5000)
    const poll = await fetch(`${base(p)}/contents/generations/tasks/${id}`, { headers: headers(p) })
    if (!poll.ok) throw new Error(await readError(poll))
    const job = await poll.json()
    if (job?.status === 'succeeded') {
      const url = job?.content?.video_url
      if (!url) throw new Error(`任务完成但没有视频地址：${JSON.stringify(job).slice(0, 200)}`)
      onProgress?.('下载视频…')
      // 结果链接约 24 小时过期，尽量抓成 dataURL 存进画布；CORS 不放行时退回原始链接
      try {
        return await fetchMediaAsDataURL(url)
      } catch {
        return url as string
      }
    }
    if (job?.status === 'failed' || job?.status === 'cancelled') {
      throw new Error(`视频任务失败：${job?.error?.message ?? job?.status}`)
    }
    onProgress?.(`视频生成中（${job?.status ?? '排队中'}）…`)
  }
}

/**
 * 文生视频：POST /videos（OpenAI 异步任务流，轮询直到完成后拉取内容）。
 * 兼容部分提供商直接同步返回 data[0].url / data[0].b64_json 的写法。
 * 硅基流动走 /video/submit + /video/status，火山方舟走 /contents/generations/tasks。
 */
export async function generateVideo(
  p: Provider,
  model: string,
  prompt: string,
  refs: VideoRefs = {},
  onProgress?: (msg: string) => void,
): Promise<string> {
  if (/siliconflow\.(cn|com)/i.test(p.baseURL)) {
    return generateVideoSiliconFlow(p, model, prompt, refs, onProgress)
  }
  if (/volces\.com/i.test(p.baseURL)) {
    return generateVideoArk(p, model, prompt, refs, onProgress)
  }
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
