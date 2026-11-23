import type { Provider } from '../types'
import type { VideoRefs } from './openai'
import { bridgeFetch } from '../bridge'

/**
 * 本地 ComfyUI（MiniMax H3 产线）适配层。
 *
 * 为什么单独一层：ComfyUI 不是 OpenAI 兼容接口，它有自己的一套：
 *   POST /upload/image   上传首帧
 *   POST /prompt         提交工作流（API 格式图）
 *   GET  /history/{id}   轮询结果
 *   GET  /view           取产物
 * 这里把「H3 图生视频」这条链路封成和 generateVideo 同签名的函数，画布上层不用知道 ComfyUI 的存在。
 *
 * CORS：ComfyUI 默认不放跨域头，所以开发期统一走 dev server 的 /__comfy 反向代理（见 vite.config.ts）；
 * 打包成静态站点后直连 baseURL，需要给 ComfyUI 加 `--enable-cors-header`，否则浏览器会被拦。
 */

export interface H3Preset {
  id: string
  label: string
  kind: 'video'
  family: 'h3'
  /** 生成分辨率，必须是 32 的倍数，0.4~0.52MP 是 8GB 卡的安全区 */
  width: number
  height: number
  /** 帧数，必须满足 17n+5 */
  length: number
  steps: number
  /** H3 原生 24fps；后处理补帧不在浏览器里做 */
  fps: number
  audio: boolean
  /** 大概耗时，给用户一个预期 */
  hint: string
}

export interface LtxPreset {
  id: string
  label: string
  kind: 'video'
  family: 'ltx'
  /** 最终像素尺寸；latent 取一半 */
  width: number
  height: number
  /** 帧数，必须 8n+1 */
  frames: number
  fps: number
  audio: boolean
  /** 是否跑第二阶段升采样精修 */
  refine: boolean
  hint: string
}

/** LTX-2.3：25fps、自带同步音轨、8GB 卡上很慢，适合过夜 */
export const LTX_PRESETS: LtxPreset[] = [
  {
    id: 'ltx-720p-2s',
    label: 'LTX-2.3 · 720p(1280×720) · 2s直出 · 带音轨',
    kind: 'video',
    family: 'ltx',
    width: 1280,
    height: 720,
    frames: 49,
    fps: 25,
    audio: true,
    refine: false,
    hint: '约 60~100 分钟（8GB 卡）',
  },
  {
    id: 'ltx-720p-2s-refine',
    label: 'LTX-2.3 · 720p · 2s升采样精修 · 带音轨',
    kind: 'video',
    family: 'ltx',
    width: 1280,
    height: 720,
    frames: 49,
    fps: 25,
    audio: true,
    refine: true,
    hint: '约 1.5~3 小时（两段采样）',
  },
  {
    id: 'ltx-720p-5s',
    label: 'LTX-2.3 · 720p · 4.8s直出 · 带音轨',
    kind: 'video',
    family: 'ltx',
    width: 1280,
    height: 720,
    frames: 121,
    fps: 25,
    audio: true,
    refine: false,
    hint: '约 2~3 小时',
  },
  {
    id: 'ltx-480p-2s',
    label: 'LTX-2.3 · 640×320 草稿 · 2s直出 · 带音轨',
    kind: 'video',
    family: 'ltx',
    width: 640,
    height: 320,
    frames: 49,
    fps: 25,
    audio: true,
    refine: false,
    hint: '约 18~27 分钟（实测）',
  },
]

export interface ImagePreset {
  id: string
  label: string
  kind: 'image'
  width: number
  height: number
  steps: number
  hint: string
}

export type ComfyPreset = H3Preset | LtxPreset | ImagePreset

/** 本地图像模型：Flux.2 klein 4B（GGUF Q4）+ Qwen3-4B 文本编码器 + Flux2 VAE */
export const IMG_PRESETS: ImagePreset[] = [
  {
    id: 'flux2-1024',
    label: 'Flux2 Klein 4B · 1024×1024 · 8步',
    kind: 'image',
    width: 1024,
    height: 1024,
    steps: 8,
    hint: '约 1 分钟',
  },
  {
    id: 'flux2-1024x1536',
    label: 'Flux2 Klein 4B · 1024×1536 竖 · 8步',
    kind: 'image',
    width: 1024,
    height: 1536,
    steps: 8,
    hint: '约 1~2 分钟',
  },
  {
    id: 'flux2-1536x1024',
    label: 'Flux2 Klein 4B · 1536×1024 横 · 8步',
    kind: 'image',
    width: 1536,
    height: 1024,
    steps: 8,
    hint: '约 1~2 分钟',
  },
  {
    id: 'flux2-1024-q4',
    label: 'Flux2 Klein 4B · 1024×1024 · 4步（更快）',
    kind: 'image',
    width: 1024,
    height: 1024,
    steps: 4,
    hint: '约 40 秒',
  },
]

export const H3_PRESETS: H3Preset[] = [
  {
    id: 'h3-16x9-6s',
    label: 'H3 横屏 960×544 · 6.6s · 20步 · 带音轨',
    kind: 'video',
    family: 'h3',
    width: 960,
    height: 544,
    length: 158,
    steps: 20,
    fps: 24,
    audio: true,
    hint: '约 15 分钟（8GB 卡）',
  },
  {
    id: 'h3-9x16-6s',
    label: 'H3 竖屏 544×960 · 6.6s · 20步 · 带音轨',
    kind: 'video',
    family: 'h3',
    width: 544,
    height: 960,
    length: 158,
    steps: 20,
    fps: 24,
    audio: true,
    hint: '约 15 分钟（8GB 卡）',
  },
  {
    id: 'h3-16x9-draft',
    label: 'H3 草稿 864×480 · 3s · 10步 · 无音轨',
    kind: 'video',
    family: 'h3',
    width: 864,
    height: 480,
    length: 73,
    steps: 10,
    fps: 24,
    audio: false,
    hint: '约 5 分钟，用来试构图和运动',
  },
  {
    id: 'h3-9x16-draft',
    label: 'H3 竖屏草稿 480×864 · 3s · 10步 · 无音轨',
    kind: 'video',
    family: 'h3',
    width: 480,
    height: 864,
    length: 73,
    steps: 10,
    fps: 24,
    audio: false,
    hint: '约 5 分钟，用来试构图和运动',
  },
]

export function presetById(id: string): ComfyPreset | undefined {
  return (
    H3_PRESETS.find((p) => p.id === id) ??
    LTX_PRESETS.find((p) => p.id === id) ??
    IMG_PRESETS.find((p) => p.id === id)
  )
}

/** 某个生成模式可选的本地预设；不给 mode 就是全部（设置页填默认模型时用） */
export function presetIds(mode?: string): string[] {
  if (mode === 'image') return IMG_PRESETS.map((p) => p.id)
  if (mode === 'video') return [...LTX_PRESETS.map((p) => p.id), ...H3_PRESETS.map((p) => p.id)]
  if (mode === 'text' || mode === 'audio') return []
  return [...IMG_PRESETS.map((p) => p.id), ...H3_PRESETS.map((p) => p.id)]
}

function cleanBase(p: Provider): string {
  return p.baseURL.replace(/\/+$/, '')
}

/** 开发期走同源代理；打包后直连（需要 ComfyUI 开 CORS）。在 Node 里跑单测时没有 import.meta.env，按直连处理 */
function isDev(): boolean {
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env
  return Boolean(env?.DEV)
}

function base(p: Provider): string {
  return isDev() ? '/__comfy' : cleanBase(p)
}

async function readError(res: Response): Promise<string> {
  try {
    return `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
  } catch {
    return `HTTP ${res.status}`
  }
}

async function jfetch(url: string, opts: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`请求 ComfyUI 超时（${Math.round(timeoutMs / 1000)} 秒）：服务可能在忙或没启动`)
    }
    if (e instanceof TypeError) {
      throw new Error(
        '连不上 ComfyUI：确认 `python_embeded\\python.exe -s ComfyUI\\main.py --lowvram ...` 已启动，' +
          '且地址是 http://127.0.0.1:8188。' +
          'ComfyUI 没起的话，在设置里点「启动 ComfyUI」即可（走本机桥，不用回命令行）。' +
          '开发模式下请求经 dev server 的 /__comfy 代理转发。',
      )
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export async function testComfy(p: Provider): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await jfetch(`${base(p)}/system_stats`, {}, 15_000)
    if (!res.ok) return { ok: false, message: await readError(res) }
    const s = await res.json()
    const vram = s?.system?.vram_total ? Math.round(s.system.vram_total / 1024 ** 2) : '?'
    return {
      ok: true,
      message: `连上了 ComfyUI ${s?.system?.comfyui_version ?? ''}，显存 ${vram}MB`,
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** 通过本机桥查 ComfyUI 是否在跑（不走 /__comfy 代理，服务没起时代理只会回 502） */
export async function comfyServerStatus(): Promise<{ up: boolean; version?: string; detail?: string }> {
  try {
    const res = await bridgeFetch('/comfy/status', {}, 8_000)
    return (await res.json()) as { up: boolean; version?: string; detail?: string }
  } catch (e) {
    return { up: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** 让本机桥把 ComfyUI 拉起来（已经在跑就直接返回；最多等 3 分钟） */
export async function startComfyServer(): Promise<{
  state: 'already' | 'started' | 'timeout' | 'error'
  seconds?: number
  version?: string
  error?: string
}> {
  const res = await bridgeFetch('/comfy/start', { method: 'POST' }, 200_000)
  return (await res.json()) as {
    state: 'already' | 'started' | 'timeout' | 'error'
    seconds?: number
    version?: string
    error?: string
  }
}

function dataURLToBlob(dataURL: string): Blob {
  const [head, b64] = dataURL.split(',')
  const mime = head.match(/data:(.*?)[;,]/)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

export function blobToDataURL(blob: Blob): Promise<string> {
  // Node（单测/脚本）里没有 FileReader，退回 arrayBuffer + base64
  if (typeof FileReader === 'undefined') {
    return blob.arrayBuffer().then(async (ab) => {
      const bytes = new Uint8Array(ab)
      let bin = ''
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
      }
      const mime = blob.type || 'application/octet-stream'
      return `data:${mime};base64,${btoa(bin)}`
    })
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** 把首帧写进 ComfyUI 的 input 目录，返回它给的相对文件名 */
async function uploadFirstFrame(p: Provider, dataURL: string): Promise<string> {
  const blob = dataURLToBlob(dataURL)
  const ext = blob.type.includes('jpeg') ? 'jpg' : blob.type.includes('webp') ? 'webp' : 'png'
  const fd = new FormData()
  fd.append('image', blob, `libre-canvas-${Date.now()}.${ext}`)
  fd.append('overwrite', 'true')
  fd.append('type', 'input')
  const res = await jfetch(`${base(p)}/upload/image`, { method: 'POST', body: fd }, 60_000)
  if (!res.ok) throw new Error('上传首帧失败：' + (await readError(res)))
  const data = await res.json()
  const name = data?.name
  if (typeof name !== 'string' || !name) throw new Error('上传首帧失败：接口没返回文件名')
  const sub = data?.subfolder ? `${data.subfolder}/${name}` : name
  return sub
}

/** 与本机 h3lib.build_i2v 等价的 API 格式图：UNET → 注意力后端 → SigmaShift → Guider → 采样 → 解码 → 视频 */
export function buildGraph(preset: H3Preset, prompt: string, imageName: string) {
  const g: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: 'minimax_h3_fl2va_pruned_w4a8_mixed.safetensors', weight_dtype: 'default' },
    },
    '2': {
      class_type: 'CLIPLoader',
      // 4B 文本编码器走 krea2；32B 原生编码器才用 minimax
      inputs: { clip_name: 'qwen3vl_4b_int8_convrot.safetensors', type: 'krea2', device: 'default' },
    },
    '3': {
      class_type: 'ClipProjApply',
      inputs: { clip: ['2', 0], projection: 'mmh3-4b-ClipProj-v3-mlp.safetensors' },
    },
    '4': { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_video_vae_int8_convrot.safetensors' } },
    '5': {
      class_type: 'ModelAttentionBackend',
      inputs: { model: ['1', 0], attention: 'comfy kitchen attention' },
    },
    '6': {
      class_type: 'MiniMaxH3SigmaShift',
      inputs: { model: ['5', 0], shift_video: 12.0, shift_audio: 3.0 },
    },
    '8': { class_type: 'LoadImage', inputs: { image: imageName } },
    '9': {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: {
        clip: ['3', 0],
        vae: ['4', 0],
        prompt,
        width: preset.width,
        height: preset.height,
        length: preset.length,
        first_frame: ['8', 0],
      },
    },
    '10': { class_type: 'BasicGuider', inputs: { model: ['6', 0], conditioning: ['9', 0] } },
    '11': {
      class_type: 'BasicScheduler',
      inputs: { model: ['6', 0], scheduler: 'simple', steps: preset.steps, denoise: 1.0 },
    },
    '12': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '13': { class_type: 'RandomNoise', inputs: { noise_seed: Math.floor(Math.random() * 1e9) } },
    '14': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['13', 0],
        guider: ['10', 0],
        sampler: ['12', 0],
        sigmas: ['11', 0],
        latent_image: ['9', 1],
      },
    },
    '15': { class_type: 'VAEDecode', inputs: { samples: ['14', 0], vae: ['4', 0] } },
    '16': {
      class_type: 'CreateVideo',
      inputs: { images: ['15', 0], fps: preset.fps, bit_depth: 'auto', color_space: 'sRGB' },
    },
    '17': {
      class_type: 'SaveVideo',
      inputs: { video: ['16', 0], filename_prefix: 'librecanvas', format: 'auto', codec: 'auto' },
    },
  }

  if (preset.audio) {
    // 音轨与画面来自同一个 latent，解码后直接喂 CreateVideo，天然同步
    g['19'] = { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' } }
    g['20'] = { class_type: 'VAEDecodeAudio', inputs: { samples: ['14', 0], vae: ['19', 0] } }
    g['16'].inputs.audio = ['20', 0]
  }
  return g
}

interface PromptResponse {
  prompt_id?: string
  error?: unknown
  node_errors?: unknown
}

async function submit(p: Provider, graph: unknown): Promise<string> {
  const res = await jfetch(
    `${base(p)}/prompt`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: 'libre-canvas' }),
    },
    60_000,
  )
  if (!res.ok) throw new Error('提交 ComfyUI 任务失败：' + (await readError(res)))
  const data = (await res.json()) as PromptResponse
  if (!data.prompt_id) {
    throw new Error('ComfyUI 拒绝了这张图：' + JSON.stringify(data.node_errors ?? data.error ?? data).slice(0, 400))
  }
  return data.prompt_id
}

interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: unknown }
  outputs?: Record<string, Record<string, unknown>>
}

async function poll(p: Provider, id: string, onProgress?: (m: string) => void): Promise<HistoryEntry> {
  const started = Date.now()
  let lastNote = ''
  for (;;) {
    if (Date.now() - started > 4 * 60 * 60_000) throw new Error('ComfyUI 任务超时（4 小时）')
    const res = await jfetch(`${base(p)}/history/${id}`, {}, 30_000)
    if (!res.ok) throw new Error('查询任务状态失败：' + (await readError(res)))
    const all = (await res.json()) as Record<string, HistoryEntry>
    const entry = all[id]
    if (entry) {
      const st = entry.status?.status_str
      if (st === 'success' || entry.status?.completed) return entry
      if (st === 'error') throw new Error('ComfyUI 执行失败：' + JSON.stringify(entry.status?.messages ?? {}).slice(0, 400))
    }
    // 队列里排第几、已经跑了多久，给用户一点"它在动"的反馈
    try {
      const q = await jfetch(`${base(p)}/queue`, {}, 15_000)
      if (q.ok) {
        const qd = await q.json()
        const running: unknown[][] = Array.isArray(qd?.queue_running) ? qd.queue_running : []
        const pending: unknown[][] = Array.isArray(qd?.queue_pending) ? qd.queue_pending : []
        const mins = Math.floor((Date.now() - started) / 60_000)
        const isMine = running.some((item) => Array.isArray(item) && item[1] === id)
        const pos = pending.findIndex((item) => Array.isArray(item) && item[1] === id)
        let note: string
        if (isMine) note = `生成中 · 已 ${mins} 分钟（8GB 卡单镜 5~15 分钟）…`
        else if (pos >= 0) note = `排队中 · 前面还有 ${pos} 个任务，已等 ${mins} 分钟…`
        else note = `生成中 · 已 ${mins} 分钟…`
        if (note !== lastNote) {
          onProgress?.(note)
          lastNote = note
        }
      }
    } catch {
      // 队列查询失败不影响主流程
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
}

function firstVideoOutput(entry: HistoryEntry): { filename: string; subfolder: string } | null {
  for (const nodeOut of Object.values(entry.outputs ?? {})) {
    for (const v of Object.values(nodeOut)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          const it = item as { filename?: string; subfolder?: string }
          if (it?.filename && /\.(mp4|webm|mov|m4v)$/i.test(it.filename)) {
            return { filename: it.filename, subfolder: it.subfolder ?? '' }
          }
        }
      }
    }
  }
  return null
}


/** LTX-2.3 图：与 ltx23_run.py 同构（阶段一采样 → 可选升采样精修 → 分离 AV → 双解码） */
export function buildLtxGraph(preset: LtxPreset, prompt: string, seed = Math.floor(Math.random() * 1e9)) {
  const lw = Math.floor(preset.width / 2)
  const lh = Math.floor(preset.height / 2)
  const SIGMAS_1 = '0.85, 0.7250, 0.4219, 0.0'
  const SIGMAS_2 = '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0'
  const NEG = 'pc game, console game, video game, cartoon, childish, ugly'

  const g: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'ltx-2.3-22b-dev-fp8.safetensors' } },
    '2': {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: ['1', 0],
        lora_name: 'ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors',
        strength_model: 0.5,
      },
    },
    '3': {
      class_type: 'LTXAVTextEncoderLoader',
      inputs: {
        text_encoder: 'gemma_3_12B_it_fp4_mixed.safetensors',
        ckpt_name: 'ltx-2.3-22b-dev-fp8.safetensors',
        device: 'default',
      },
    },
    '4': {
      class_type: 'LoraLoader',
      inputs: {
        model: ['2', 0],
        clip: ['3', 0],
        lora_name: 'gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors',
        strength_model: 0,
        strength_clip: 0,
      },
    },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: prompt } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: NEG } },
    '7': {
      class_type: 'LTXVConditioning',
      inputs: { positive: ['5', 0], negative: ['6', 0], frame_rate: 25 },
    },
    '10': {
      class_type: 'EmptyLTXVLatentVideo',
      inputs: { width: lw, height: lh, length: preset.frames, batch_size: 1 },
    },
    '11': { class_type: 'LTXVAudioVAELoader', inputs: { ckpt_name: 'ltx-2.3-22b-dev-fp8.safetensors' } },
    '12': {
      class_type: 'LTXVEmptyLatentAudio',
      inputs: { frames_number: preset.frames, frame_rate: 25, batch_size: 1, audio_vae: ['11', 0] },
    },
    '13': { class_type: 'EmptyImage', inputs: { width: 512, height: 512, batch_size: 1, color: 0 } },
    '14': { class_type: 'LTXVPreprocess', inputs: { image: ['13', 0], img_compression: 18 } },
    '15': {
      class_type: 'LTXVImgToVideoInplace',
      inputs: { vae: ['1', 2], image: ['14', 0], latent: ['10', 0], strength: 0.7, bypass: true },
    },
    '16': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['15', 0], audio_latent: ['12', 0] } },
    '20': { class_type: 'ManualSigmas', inputs: { sigmas: SIGMAS_1 } },
    '21': {
      class_type: 'CFGGuider',
      inputs: { model: ['4', 0], positive: ['7', 0], negative: ['7', 1], cfg: 1 },
    },
    '22': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '23': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '24': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['22', 0], guider: ['21', 0], sampler: ['23', 0],
        sigmas: ['20', 0], latent_image: ['16', 0],
      },
    },
    '25': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['24', 0] } },
  }

  if (preset.refine) {
    Object.assign(g, {
      '30': { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors' } },
      '31': {
        class_type: 'LTXVLatentUpsampler',
        inputs: { samples: ['25', 0], upscale_model: ['30', 0], vae: ['1', 2] },
      },
      '32': {
        class_type: 'LTXVImgToVideoInplace',
        inputs: { vae: ['1', 2], image: ['14', 0], latent: ['31', 0], strength: 1, bypass: true },
      },
      '33': { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['32', 0], audio_latent: ['25', 1] } },
      '34': { class_type: 'ManualSigmas', inputs: { sigmas: SIGMAS_2 } },
      '35': {
        class_type: 'CFGGuider',
        inputs: { model: ['4', 0], positive: ['7', 0], negative: ['7', 1], cfg: 1 },
      },
      '36': { class_type: 'RandomNoise', inputs: { noise_seed: seed + 1 } },
      '37': {
        class_type: 'SamplerCustomAdvanced',
        inputs: {
          noise: ['36', 0], guider: ['35', 0], sampler: ['23', 0],
          sigmas: ['34', 0], latent_image: ['33', 0],
        },
      },
      '38': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['37', 0] } },
    })
  }

  const src = preset.refine ? '38' : '25'
  Object.assign(g, {
    '40': {
      class_type: 'VAEDecodeTiled',
      inputs: { samples: [src, 0], vae: ['1', 2], tile_size: 512, overlap: 64, temporal_size: 4096, temporal_overlap: 4 },
    },
    '41': { class_type: 'LTXVAudioVAEDecode', inputs: { samples: [src, 1], audio_vae: ['11', 0] } },
    '42': {
      class_type: 'CreateVideo',
      inputs: { images: ['40', 0], audio: ['41', 0], fps: 25, bit_depth: 'auto', color_space: 'sRGB' },
    },
    '43': { class_type: 'SaveVideo', inputs: { video: ['42', 0], filename_prefix: 'libre-ltx', format: 'auto', codec: 'auto' } },
  })
  return g
}

/** Flux2 Klein 4B 文生图：GGUF unet + Qwen3-4B(GGUF) 文本编码器 + Flux2 VAE */
export function buildImageGraph(preset: ImagePreset, prompt: string) {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'flux-2-klein-4b-Q4_0.gguf' } },
    '2': {
      class_type: 'CLIPLoaderGGUF',
      inputs: { clip_name: 'Qwen3-4B-Q4_K_M.gguf', type: 'flux2' },
    },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
    '6': {
      class_type: 'EmptyFlux2LatentImage',
      inputs: { width: preset.width, height: preset.height, batch_size: 1 },
    },
    '7': {
      class_type: 'Flux2Scheduler',
      inputs: { steps: preset.steps, width: preset.width, height: preset.height },
    },
    '8': { class_type: 'BasicGuider', inputs: { model: ['1', 0], conditioning: ['4', 0] } },
    '9': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '10': { class_type: 'RandomNoise', inputs: { noise_seed: Math.floor(Math.random() * 1e9) } },
    '11': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['10', 0],
        guider: ['8', 0],
        sampler: ['9', 0],
        sigmas: ['7', 0],
        latent_image: ['6', 0],
      },
    },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    '13': {
      class_type: 'SaveImage',
      inputs: { images: ['12', 0], filename_prefix: 'libre-flux2' },
    },
  }
}

function firstImageOutput(entry: HistoryEntry): { filename: string; subfolder: string } | null {
  for (const nodeOut of Object.values(entry.outputs ?? {})) {
    for (const v of Object.values(nodeOut)) {
      if (!Array.isArray(v)) continue
      for (const item of v) {
        const it = item as { filename?: string; subfolder?: string }
        if (it?.filename && /\.(png|webp|jpe?g)$/i.test(it.filename)) {
          return { filename: it.filename, subfolder: it.subfolder ?? '' }
        }
      }
    }
  }
  return null
}

/** 本地文生图：提交 → 轮询 → 取图 → dataURL */
export async function generateComfyImage(
  p: Provider,
  model: string,
  prompt: string,
  onProgress?: (m: string) => void,
): Promise<string> {
  const preset = IMG_PRESETS.find((x) => x.id === model)
  if (!preset) throw new Error(`未知的图像预设「${model}」，请在节点里重新选一个`)
  onProgress?.(`提交文生图（${preset.width}×${preset.height} / ${preset.steps} 步）…`)
  const id = await submit(p, buildImageGraph(preset, prompt))
  const entry = await poll(p, id, onProgress)
  const out = firstImageOutput(entry)
  if (!out) throw new Error('任务完成但没有图片产物（检查 SaveImage 节点）')
  onProgress?.('下载图片…')
  const qs = new URLSearchParams({ filename: out.filename, subfolder: out.subfolder, type: 'output' })
  const res = await jfetch(`${base(p)}/view?${qs.toString()}`, {}, 120_000)
  if (!res.ok) throw new Error('下载图片失败：' + (await readError(res)))
  return blobToDataURL(await res.blob())
}
export async function generateComfyVideo(
  p: Provider,
  model: string,
  prompt: string,
  refs: VideoRefs = {},
  onProgress?: (m: string) => void,
): Promise<string> {
  const h3 = H3_PRESETS.find((x) => x.id === model)
  const ltx = LTX_PRESETS.find((x) => x.id === model)
  if (!h3 && !ltx) throw new Error(`未知的视频预设「${model}」，请在节点里重新选一个`)

  let id: string
  if (ltx) {
    // LTX 是 t2v：不需要首帧，提示词直接进图
    onProgress?.(`提交 LTX（${ltx.width}×${ltx.height} / ${ltx.frames} 帧${ltx.refine ? ' / 两段精修' : ' / 直出'}）…`)
    id = await submit(p, buildLtxGraph(ltx, prompt))
  } else {
    const first = refs.images?.[0]
    if (!first) {
      throw new Error('H3 图生视频需要一张首帧：把一张图片卡右侧圆点拖到本节点上，再生成')
    }
    onProgress?.('上传首帧…')
    const imageName = await uploadFirstFrame(p, first)
    onProgress?.('提交任务…')
    id = await submit(p, buildGraph(h3!, prompt, imageName))
  }
  const entry = await poll(p, id, onProgress)
  const out = firstVideoOutput(entry)
  if (!out) throw new Error('任务完成但没有视频产物（检查工作流是否接了 SaveVideo）')
  onProgress?.('下载成片…')
  const qs = new URLSearchParams({ filename: out.filename, subfolder: out.subfolder, type: 'output' })
  const res = await jfetch(`${base(p)}/view?${qs.toString()}`, {}, 10 * 60_000)
  if (!res.ok) throw new Error('下载成片失败：' + (await readError(res)))
  return blobToDataURL(await res.blob())
}
