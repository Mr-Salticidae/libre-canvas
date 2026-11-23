import { useStore } from './store'
import { useUI } from './ui'
import { useProviders } from './providers'
import { uid, type CanvasNode } from './types'
import {
  generateImage,
  generateImageEdit,
  generateSpeech,
  generateText,
  generateVideo,
} from './api/openai'
import { generateComfyImage, generateComfyVideo, presetById } from './api/comfyui'
import { fitSize, loadImage, loadVideoMeta } from './helpers'

/**
 * 跑一次生成。
 *
 * 从这里抽出来，是因为「生成」不止一个入口：右侧属性面板的按钮、底部提示词栏的回车、
 * 以后可能的批量生成，都该走同一条路径。之前这段逻辑埋在 Inspector 里，别的入口只能复制。
 */

/** 指向某节点的参考输入，按卡片类型分组 */
export function refsOf(nodeId: string) {
  const { nodes, edges } = useStore.getState()
  const refEdges = edges
    .map((edge) => ({ edge, from: nodes[edge.from] }))
    .filter(
      (r) =>
        r.edge.to === nodeId &&
        (((r.from?.type === 'image' || r.from?.type === 'video' || r.from?.type === 'audio') &&
          r.from.src) ||
          (r.from?.type === 'text' && r.from.text?.trim())),
    )
  const imageRefs = refEdges.filter((r) => r.from!.type === 'image')
  const textRefs = refEdges.filter((r) => r.from!.type === 'text')
  const videoRefs = refEdges.filter((r) => r.from!.type === 'video')
  const audioRefs = refEdges.filter((r) => r.from!.type === 'audio')
  return {
    refEdges,
    imageRefs,
    textRefs,
    videoRefs,
    audioRefs,
    refImages: imageRefs.map((r) => r.from!.src!),
  }
}

export async function runGenerator(nodeId: string): Promise<void> {
  const st = useStore.getState()
  const node: CanvasNode | undefined = st.nodes[nodeId]
  if (!node || node.type !== 'generator') return
  const providers = useProviders.getState().providers
  const provider = providers.find((p) => p.id === node.providerId) ?? providers[0]
  if (!provider) {
    useUI.getState().setSettingsOpen(true)
    return
  }
  const model = node.model?.trim()
  const prompt = node.prompt?.trim()
  if (!model) {
    st.updateNode(node.id, { status: 'error', error: '请先填写模型名' })
    return
  }
  if (!prompt) {
    st.updateNode(node.id, { status: 'error', error: '请先填写提示词' })
    return
  }

  const { textRefs, videoRefs, audioRefs, refImages } = refsOf(node.id)
  const refTextContents = textRefs.map((r) => r.from!.text!.trim())
  const fullPrompt =
    refTextContents.length > 0 && node.mode !== 'audio'
      ? `${prompt}\n\n【引用资料】\n${refTextContents.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : prompt

  st.updateNode(node.id, {
    status: 'running',
    error: undefined,
    progress:
      provider.kind === 'comfyui'
        ? `预计 ${presetById(model)?.hint ?? '5~15 分钟'}，准备中…`
        : undefined,
  })

  const outPos = { x: node.x + node.width + 80, y: node.y }
  const updateNode = (patch: Partial<CanvasNode>) => useStore.getState().updateNode(node.id, patch)
  try {
    if (node.mode === 'text') {
      const text = await generateText(provider, model, fullPrompt, refImages)
      const out = { id: uid(), type: 'text' as const, ...outPos, width: 360, height: 120, text }
      st.addNode(out, { history: false })
      st.addEdge({ id: uid(), from: node.id, to: out.id })
    } else if (node.mode === 'video') {
      const refs = {
        images: refImages,
        videos: videoRefs.map((r) => r.from!.src!),
        audios: audioRefs.map((r) => r.from!.src!),
      }
      const src =
        provider.kind === 'comfyui'
          ? await generateComfyVideo(provider, model, fullPrompt, refs, (msg) =>
              updateNode({ progress: msg }),
            )
          : await generateVideo(provider, model, fullPrompt, refs, (msg) =>
              updateNode({ progress: msg }),
            )
      const { width, height } = await loadVideoMeta(src)
      const out = {
        id: uid(),
        type: 'video' as const,
        ...outPos,
        width,
        height,
        src,
        name: prompt.slice(0, 30),
      }
      st.addNode(out, { history: false })
      st.addEdge({ id: uid(), from: node.id, to: out.id })
    } else if (node.mode === 'audio') {
      const src = await generateSpeech(provider, model, prompt, node.voice ?? 'alloy')
      const out = {
        id: uid(),
        type: 'audio' as const,
        ...outPos,
        width: 280,
        height: 84,
        src,
        name: prompt.slice(0, 30),
      }
      st.addNode(out, { history: false })
      st.addEdge({ id: uid(), from: node.id, to: out.id })
    } else {
      // 本地 ComfyUI 走 Flux2 文生图；云端走 OpenAI 兼容接口
      const src =
        provider.kind === 'comfyui'
          ? await generateComfyImage(provider, model, fullPrompt, (msg) =>
              updateNode({ progress: msg }),
            )
          : refImages.length > 0
            ? await generateImageEdit(provider, model, fullPrompt, refImages)
            : await generateImage(provider, model, fullPrompt)
      const img = await loadImage(src)
      const { width, height } = fitSize(img.naturalWidth, img.naturalHeight)
      const out = { id: uid(), type: 'image' as const, ...outPos, width, height, src }
      st.addNode(out, { history: false })
      st.addEdge({ id: uid(), from: node.id, to: out.id })
    }
    updateNode({ status: 'idle', progress: undefined })
  } catch (e) {
    updateNode({
      status: 'error',
      progress: undefined,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
