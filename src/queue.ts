import { useStore } from './store'
import { useUI } from './ui'
import { bridgeFetch } from './bridge'
import { presetById } from './api/comfyui'
import { uid } from './types'

/**
 * 把画布上的生成节点加入「夜间队列」。
 *
 * 队列由 `minimax_h3_tool/scripts/night_queue.py` 串行消费：生成 → 后处理 → 质检，
 * 全程不需要浏览器开着。画布只负责把任务写进 queue.night.json。
 *
 * 注意首帧：画布里的图片是 dataURL，而队列要的是 ComfyUI input 目录里的文件名，
 * 所以这里把 dataURL 一起发给本机桥，由桥上转到 ComfyUI 的 /upload/image。
 */
export async function addNodeToNightQueue(nodeId: string): Promise<{ id: string; count: number }> {
  const st = useStore.getState()
  const node = st.nodes[nodeId]
  if (!node || node.type !== 'generator') throw new Error('只能把生成节点加入队列')
  const preset = presetById(node.model ?? '')
  if (!preset || preset.kind !== 'video') {
    throw new Error('只有视频预设能进夜间队列（图像几秒就出，用不着排队）')
  }
  const prompt = (node.prompt ?? '').trim()
  if (!prompt) throw new Error('提示词是空的')

  // 首帧：指向本节点的图片引用
  const edge = st.edges.find((e) => e.to === node.id && st.nodes[e.from]?.type === 'image')
  const first = edge ? st.nodes[edge.from]?.src : undefined

  const id = 's' + uid().slice(0, 6)
  const job: Record<string, unknown> = {
    id,
    type: 'h3',
    prompt,
    width: preset.width,
    height: preset.height,
    length: preset.length,
    steps: preset.steps,
    seed: Math.floor(Math.random() * 1e6),
    audio: preset.audio,
    target: '1920x1080',
    fps: 60,
  }
  if (first) job.image_data_url = first

  const ui = useUI.getState()
  const jobKey = 'queue-' + id
  ui.setJob({ id: jobKey, label: `加入夜间队列 ${id}`, progress: 30, state: 'running', note: '上传首帧…' })
  try {
    const res = await bridgeFetch(
      '/queue/add',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job }) },
      120_000,
    )
    const data = (await res.json()) as { ok?: boolean; error?: string; count?: number; id?: string }
    if (!res.ok || !data.ok) throw new Error(data.error || `桥返回 ${res.status}`)
    ui.patchJob(jobKey, {
      state: 'done',
      progress: 100,
      note: `已加入（队列共 ${data.count} 条）${first ? '' : ' · 无首帧'}`,
    })
    setTimeout(() => useUI.getState().removeJob(jobKey), 8000)
    return { id: data.id || id, count: data.count ?? 0 }
  } catch (e) {
    ui.patchJob(jobKey, {
      state: 'error',
      progress: 100,
      note: (e instanceof Error ? e.message : String(e)).slice(0, 120),
    })
    throw e
  }
}
