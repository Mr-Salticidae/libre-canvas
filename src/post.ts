import { useStore } from './store'
import { useUI } from './ui'
import { uid, type CanvasNode } from './types'
import { loadVideoMeta } from './helpers'
import { bridgeFetch } from './bridge'

/**
 * 本地后处理：把画布上的视频卡送进本机产线脚本（Real-ESRGAN 超分 + RIFE 补帧 → 1080p），
 * 结果作为新卡落回画布，并从原卡拉一条血缘线；出片后自动质检。
 *
 * 为什么要有桥：超分/补帧是 Python + ncnn，浏览器跑不了。scripts/post-bridge.mjs 起一个本机
 * HTTP 服务，接收视频二进制、调用 post_1080p60.py / quality_check.py、回报进度、把成片吐回来。
 */



export interface PostOptions {
  target?: string
  fps?: number
  motionBlur?: boolean
  /** 处理完自动跑质检（默认开） */
  qc?: boolean
}

export interface QcResult {
  ok: boolean
  fails: string[]
  warns: string[]
  facts?: Record<string, unknown>
}

async function dataURLToBlob(src: string): Promise<Blob> {
  const res = await fetch(src)
  return await res.blob()
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}



const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 调后处理桥跑一次成片质检（黑屏 / 冻帧 / 静音 / 削波 / 手机兼容） */
export async function checkVideo(
  src: string,
  opts: { target?: string; fps?: number; audio?: boolean } = {},
): Promise<QcResult> {
  const blob = await dataURLToBlob(src)
  // 只有明确知道交付规格时才传 expect/fps；否则只做结构检查，避免拿 1080p60 去卡原片
  const qs = new URLSearchParams()
  if (opts.target) qs.set('expect', opts.target)
  if (opts.fps) qs.set('fps', String(opts.fps))
  // canvas 不知道这一镜"该不该有声音"，所以默认 any：有音轨就查静音/削波，没有也不判失败
  if (opts.audio === true) qs.set('audio', 'yes')
  else if (opts.audio === false) qs.set('audio', 'no')
  const res = await bridgeFetch(
    `/qc?${qs.toString()}`,
    { method: 'POST', headers: { 'content-type': blob.type || 'video/mp4' }, body: blob },
    10 * 60_000,
  )
  if (!res.ok) throw new Error(`质检桥拒绝：HTTP ${res.status}`)
  return (await res.json()) as QcResult
}

type Stage = (progress: number, note: string) => void

/** 跑一张卡：上传 → 后处理 → 取回 → 落卡 → 质检。progress 回调把阶段透给任务面板 */
async function runOne(node: CanvasNode, opts: PostOptions, stage: Stage): Promise<CanvasNode> {
  const target = opts.target ?? '1920x1080'
  const fps = opts.fps ?? 60
  stage(2, '上传到后处理桥…')
  const blob = await dataURLToBlob(node.src!)
  const qs = new URLSearchParams({ target, fps: String(fps), blur: opts.motionBlur ? '1' : '0' })
  const res = await bridgeFetch(`/post?${qs.toString()}`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'video/mp4' },
    body: blob,
  })
  if (!res.ok) throw new Error(`后处理桥拒绝：HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const { id } = (await res.json()) as { id: string }

  let note = ''
  for (;;) {
    await sleep(2000)
    const s = await bridgeFetch(`/status?id=${id}`)
    if (!s.ok) throw new Error('查询后处理进度失败')
    const st = (await s.json()) as { state: string; progress: number; note?: string; error?: string }
    if (st.note && st.note !== note) {
      note = st.note
      stage(st.progress, note)
    } else {
      stage(st.progress, note || '处理中…')
    }
    if (st.state === 'error') throw new Error(st.error || '后处理失败')
    if (st.state === 'done') break
  }

  stage(97, '取回成片…')
  const file = await bridgeFetch(`/result?id=${id}`, {}, 10 * 60_000)
  if (!file.ok) throw new Error('取回成片失败')
  const dataURL = await blobToDataURL(await file.blob())
  const meta = await loadVideoMeta(dataURL)

  const cur = useStore.getState()
  const out: CanvasNode = {
    id: uid(),
    type: 'video',
    x: node.x + node.width + 80,
    y: node.y,
    width: meta.width,
    height: meta.height,
    src: dataURL,
    name: `${node.name || '视频'}_${target.replace('x', '×')}`,
  }
  cur.addNode(out)
  cur.addEdge({ id: uid(), from: node.id, to: out.id })

  if (opts.qc !== false) {
    stage(99, '质检中…')
    try {
      const qc = await checkVideo(dataURL, { target, fps })
      useStore.getState().updateNode(out.id, { qc: { ...qc, at: Date.now() } })
      out.qc = { ...qc, at: Date.now() }
    } catch {
      // 质检没跑成不影响出片
    }
  }
  return out
}

function nodeById(id: string): CanvasNode | undefined {
  return useStore.getState().nodes[id]
}

function pickVideos(ids: string[]): CanvasNode[] {
  return ids
    .map(nodeById)
    .filter((n): n is CanvasNode => Boolean(n && n.type === 'video' && n.src))
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
}

/** 单张：右键「出 1080p 母版」 */
export async function postProcessNode(nodeId: string, opts: PostOptions = {}): Promise<void> {
  const node = nodeById(nodeId)
  if (!node || node.type !== 'video' || !node.src) throw new Error('这张卡不是可处理的视频')
  const target = opts.target ?? '1920x1080'
  const fps = opts.fps ?? 60
  const jobId = 'post-' + uid()
  useUI.getState().setJob({
    id: jobId,
    label: `${node.name || '视频'} → ${target}@${fps}`,
    progress: 1,
    state: 'running',
    note: '准备中…',
  })
  try {
    const out = await runOne(node, opts, (p, note) =>
      useUI.getState().patchJob(jobId, { progress: p, note }),
    )
    const qc = out.qc
    useUI.getState().patchJob(jobId, {
      state: qc && !qc.ok ? 'error' : 'done',
      progress: 100,
      note: qc
        ? qc.ok
          ? `完成 · 质检通过${qc.warns.length ? `（${qc.warns.length} 条提示）` : ''}`
          : `完成 · 质检不通过：${qc.fails[0] ?? ''}`
        : '完成',
    })
    setTimeout(() => useUI.getState().removeJob(jobId), 8000)
  } catch (e) {
    useUI.getState().patchJob(jobId, {
      state: 'error',
      progress: 100,
      note: (e instanceof Error ? e.message : String(e)).slice(0, 120),
    })
  }
}

/** 批量：框选多张视频卡，按画布顺序逐张跑（串行，避免抢同一张卡） */
export async function postProcessBatch(nodeIds: string[], opts: PostOptions = {}): Promise<void> {
  const nodes = pickVideos(nodeIds)
  if (nodes.length === 0) throw new Error('选中的卡片里没有视频')
  const target = opts.target ?? '1920x1080'
  const fps = opts.fps ?? 60
  const jobId = 'batch-' + uid()
  const total = nodes.length
  const results: { name: string; ok: boolean; note: string }[] = []

  useUI.getState().setJob({
    id: jobId,
    label: `批量 ${total} 张 → ${target}@${fps}`,
    progress: 0,
    state: 'running',
    note: '准备中…',
  })

  for (let i = 0; i < total; i++) {
    const node = nodes[i]
    const base = (i / total) * 100
    const span = 100 / total
    const label = node.name || node.id.slice(0, 6)
    useUI.getState().patchJob(jobId, {
      note: `第 ${i + 1}/${total} 张：${label}`,
    })
    try {
      const out = await runOne(node, opts, (p, note) => {
        useUI.getState().patchJob(jobId, {
          progress: Math.min(99, base + (p / 100) * span),
          note: `第 ${i + 1}/${total} 张：${label} · ${note}`,
        })
      })
      const qc = out.qc
      results.push({
        name: label,
        ok: qc ? qc.ok : true,
        note: qc ? (qc.ok ? `提示 ${qc.warns.length}` : qc.fails[0] ?? '不通过') : '已出片',
      })
    } catch (e) {
      results.push({
        name: label,
        ok: false,
        note: (e instanceof Error ? e.message : String(e)).slice(0, 80),
      })
    }
  }

  const bad = results.filter((r) => !r.ok)
  const okCount = total - bad.length
  useUI.getState().patchJob(jobId, {
    state: bad.length > 0 ? 'error' : 'done',
    progress: 100,
    note:
      bad.length === 0
        ? `全部完成：${okCount} 张，质检全通过`
        : `完成 ${okCount}/${total}，${bad.length} 张有问题：${bad
            .slice(0, 3)
            .map((b) => `${b.name}（${b.note}）`)
            .join('，')}${bad.length > 3 ? ' 等' : ''}`,
  })
  setTimeout(() => useUI.getState().removeJob(jobId), bad.length > 0 ? 30_000 : 10_000)
}

/** 批量质检（不出片，只检已有的卡） */
export async function qcBatch(nodeIds: string[], opts: { target?: string; fps?: number } = {}): Promise<void> {
  const nodes = pickVideos(nodeIds)
  if (nodes.length === 0) throw new Error('选中的卡片里没有视频')
  const jobId = 'qcbatch-' + uid()
  const total = nodes.length
  useUI.getState().setJob({ id: jobId, label: `批量质检 ${total} 张`, progress: 0, state: 'running', note: '检查中…' })
  const bad: string[] = []
  for (let i = 0; i < total; i++) {
    const node = nodes[i]
    try {
      const qc = await checkVideo(node.src!, opts)
      useStore.getState().updateNode(node.id, { qc: { ...qc, at: Date.now() } })
      if (!qc.ok) bad.push(`${node.name || node.id.slice(0, 6)}`)
    } catch (e) {
      bad.push(`${node.name || node.id.slice(0, 6)}（${(e instanceof Error ? e.message : String(e)).slice(0, 40)}）`)
    }
    useUI.getState().patchJob(jobId, {
      progress: ((i + 1) / total) * 100,
      note: `已检 ${i + 1}/${total}`,
    })
  }
  useUI.getState().patchJob(jobId, {
    state: bad.length > 0 ? 'error' : 'done',
    progress: 100,
    note: bad.length === 0 ? `${total} 张全部通过` : `${bad.length} 张不通过：${bad.slice(0, 3).join('，')}${bad.length > 3 ? ' 等' : ''}`,
  })
  setTimeout(() => useUI.getState().removeJob(jobId), bad.length > 0 ? 30_000 : 8_000)
}

/** 对一张已有的视频卡跑质检，结果写回节点（右上角徽标） */
export async function qcNode(
  nodeId: string,
  opts: { target?: string; fps?: number; audio?: boolean } = {},
): Promise<void> {
  const node = nodeById(nodeId)
  if (!node || node.type !== 'video' || !node.src) throw new Error('这张卡不是可质检的视频')
  const jobId = 'qc-' + uid()
  useUI.getState().setJob({ id: jobId, label: `质检 ${node.name || '视频'}`, progress: 20, state: 'running', note: '检查中…' })
  try {
    const qc = await checkVideo(node.src, opts)
    useStore.getState().updateNode(nodeId, { qc: { ...qc, at: Date.now() } })
    useUI.getState().patchJob(jobId, {
      state: qc.ok ? 'done' : 'error',
      progress: 100,
      note: qc.ok ? `通过${qc.warns.length ? `（${qc.warns.length} 条提示）` : ''}` : qc.fails[0] ?? '不通过',
    })
    setTimeout(() => useUI.getState().removeJob(jobId), 6000)
  } catch (e) {
    useUI.getState().patchJob(jobId, {
      state: 'error',
      progress: 100,
      note: (e instanceof Error ? e.message : String(e)).slice(0, 120),
    })
  }
}
