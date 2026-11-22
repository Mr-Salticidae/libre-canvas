import { useStore } from './store'
import { useUI } from './ui'
import { uid } from './types'
import { loadVideoMeta } from './helpers'

/**
 * 本地后处理：把画布上的视频卡送进本机产线脚本（Real-ESRGAN 超分 + RIFE 补帧 → 1080p），
 * 结果作为新卡落回画布，并从原卡拉一条血缘线。
 *
 * 为什么要有桥：超分/补帧是 Python + ncnn，浏览器跑不了。scripts/post-bridge.mjs 起一个本机
 * HTTP 服务，接收视频二进制、调用 post_1080p60.py、回报进度、最后把成片吐回来。
 */

const BRIDGE = (import.meta.env.VITE_POST_BRIDGE as string | undefined) || 'http://127.0.0.1:8791'

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

/** 调后处理桥跑一次成片质检（黑屏 / 冻帧 / 静音 / 削波 / 手机兼容） */
export async function checkVideo(
  src: string,
  opts: { target?: string; fps?: number; audio?: boolean } = {},
): Promise<QcResult> {
  const blob = await dataURLToBlob(src)
  const qs = new URLSearchParams({
    expect: opts.target ?? '1920x1080',
    fps: String(opts.fps ?? 60),
  })
  // canvas 不知道这一镜"该不该有声音"，所以默认 any：有音轨就查静音/削波，没有也不判失败
  if (opts.audio === true) qs.set('audio', 'yes')
  else if (opts.audio === false) qs.set('audio', 'no')
  const res = await bridgeFetch(`/qc?${qs.toString()}`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'video/mp4' },
    body: blob,
  }, 10 * 60_000)
  if (!res.ok) throw new Error(`质检桥拒绝：HTTP ${res.status}`)
  return (await res.json()) as QcResult
}

/** 对一张已有的视频卡跑质检，结果写回节点（右上角徽标） */
export async function qcNode(nodeId: string, opts: { target?: string; fps?: number; audio?: boolean } = {}): Promise<void> {
  const store = useStore.getState()
  const node = store.nodes[nodeId]
  if (!node || node.type !== 'video' || !node.src) throw new Error('这张卡不是可质检的视频')
  const ui = useUI.getState()
  const jobId = 'qc-' + uid()
  ui.setJob({ id: jobId, label: `质检 ${node.name || '视频'}`, progress: 20, state: 'running', note: '检查中…' })
  try {
    const qc = await checkVideo(node.src, opts)
    useStore.getState().updateNode(nodeId, { qc: { ...qc, at: Date.now() } })
    useUI.getState().patchJob(jobId, {
      state: qc.ok ? 'done' : 'error',
      progress: 100,
      note: qc.ok
        ? `通过${qc.warns.length ? `（${qc.warns.length} 条提示）` : ''}`
        : qc.fails[0] ?? '不通过',
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

async function bridgeFetch(path: string, init?: RequestInit, timeoutMs = 60_000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(`${BRIDGE}${path}`, { ...init, signal: ctrl.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('后处理桥超时')
    throw new Error(
      '连不上后处理桥：请先在项目目录跑 `npm run post:bridge`（默认 http://127.0.0.1:8791）',
    )
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 对一张视频卡跑后处理，全程在左下角任务面板显示进度 */
export async function postProcessNode(nodeId: string, opts: PostOptions = {}): Promise<void> {
  const store = useStore.getState()
  const node = store.nodes[nodeId]
  if (!node || node.type !== 'video' || !node.src) {
    throw new Error('这张卡不是可处理的视频')
  }
  const ui = useUI.getState()
  const jobId = 'post-' + uid()
  const target = opts.target ?? '1920x1080'
  const fps = opts.fps ?? 60
  ui.setJob({
    id: jobId,
    label: `${node.name || '视频'} → ${target}@${fps}`,
    progress: 1,
    state: 'running',
    note: '上传到后处理桥…',
  })

  try {
    const blob = await dataURLToBlob(node.src)
    const qs = new URLSearchParams({ target, fps: String(fps), blur: opts.motionBlur ? '1' : '0' })
    const res = await bridgeFetch(`/post?${qs.toString()}`, {
      method: 'POST',
      headers: { 'content-type': blob.type || 'video/mp4' },
      body: blob,
    })
    if (!res.ok) throw new Error(`后处理桥拒绝：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    const { id } = (await res.json()) as { id: string }

    let note = ''
    for (;;) {
      await sleep(2000)
      const s = await bridgeFetch(`/status?id=${id}`)
      if (!s.ok) throw new Error('查询后处理进度失败')
      const st = (await s.json()) as { state: string; progress: number; note?: string; error?: string }
      if (st.note && st.note !== note) {
        note = st.note
        useUI.getState().patchJob(jobId, { progress: st.progress, note: st.note })
      } else {
        useUI.getState().patchJob(jobId, { progress: st.progress })
      }
      if (st.state === 'error') throw new Error(st.error || '后处理失败')
      if (st.state === 'done') break
    }

    useUI.getState().patchJob(jobId, { progress: 97, note: '取回成片…' })
    const file = await bridgeFetch(`/result?id=${id}`, {}, 10 * 60_000)
    if (!file.ok) throw new Error('取回成片失败')
    const outBlob = await file.blob()
    const dataURL = await blobToDataURL(outBlob)
    const meta = await loadVideoMeta(dataURL)

    const cur = useStore.getState()
    const out = {
      id: uid(),
      type: 'video' as const,
      x: node.x + node.width + 80,
      y: node.y,
      width: meta.width,
      height: meta.height,
      src: dataURL,
      name: `${node.name || '视频'}_${target.replace('x', '×')}`,
    }
    cur.addNode(out)
    cur.addEdge({ id: uid(), from: node.id, to: out.id })
    useUI.getState().patchJob(jobId, { progress: 99, note: '质检中…' })

    // 出片即质检：黑屏/冻帧/静音这类问题当场标在卡片上，不用等人工发现
    let qcNote = '完成'
    if (opts.qc !== false) {
      try {
        const qc = await checkVideo(dataURL, { target, fps })
        useStore.getState().updateNode(out.id, { qc: { ...qc, at: Date.now() } })
        qcNote = qc.ok
          ? `完成 · 质检通过${qc.warns.length ? `（${qc.warns.length} 条提示）` : ''}`
          : `完成 · 质检不通过：${qc.fails[0] ?? ''}`
      } catch (e) {
        qcNote = '完成（质检没跑成：' + (e instanceof Error ? e.message : String(e)).slice(0, 40) + '）'
      }
    }

    useUI.getState().patchJob(jobId, { state: 'done', progress: 100, note: qcNote })
    setTimeout(() => useUI.getState().removeJob(jobId), 8000)
  } catch (e) {
    useUI.getState().patchJob(jobId, {
      state: 'error',
      progress: 100,
      note: (e instanceof Error ? e.message : String(e)).slice(0, 120),
    })
  }
}
