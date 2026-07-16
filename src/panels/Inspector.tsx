import { useStore } from '../store'
import { useProviders } from '../providers'
import { useUI } from '../ui'
import { uid, type GenMode } from '../types'
import {
  generateImage,
  generateImageEdit,
  generateSpeech,
  generateText,
  generateVideo,
} from '../api/openai'
import { fitSize, loadImage, loadVideoMeta } from '../helpers'
import { MODE_LABEL } from '../canvas/nodes'

const MODES: GenMode[] = ['image', 'text', 'video', 'audio']

const MODEL_PLACEHOLDER: Record<GenMode, string> = {
  image: '如 gpt-image-1',
  text: '如 gpt-4o-mini / deepseek-chat',
  video: '如 sora-2',
  audio: '如 gpt-4o-mini-tts / tts-1',
}

/** 右侧属性面板：选中单个生成节点时出现 */
export function Inspector() {
  const selection = useStore((s) => s.selection)
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const updateNode = useStore((s) => s.updateNode)
  const addNode = useStore((s) => s.addNode)
  const addEdge = useStore((s) => s.addEdge)
  const removeEdge = useStore((s) => s.removeEdge)
  const providers = useProviders((s) => s.providers)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)

  const node = selection.length === 1 ? nodes[selection[0]] : undefined

  if (node && node.type === 'image' && node.src) {
    return (
      <div className="inspector">
        <h3>🖼 图片</h3>
        {node.name && <p className="hint">{node.name}</p>}
        <button className="primary" onClick={() => useUI.getState().setMaskEditingId(node.id)}>
          🖌 局部重绘
        </button>
        <p className="hint">涂抹指定区域，用提示词重新生成该区域（inpainting）。</p>
      </div>
    )
  }

  if (!node || node.type !== 'generator') return null

  const provider = providers.find((p) => p.id === node.providerId) ?? providers[0]

  // 参考输入：指向本节点的边里，源头是图片的
  const refEdges = edges
    .map((e) => ({ edge: e, from: nodes[e.from] }))
    .filter((r) => r.edge.to === node.id && r.from?.type === 'image' && r.from.src)
  const refImages = refEdges.map((r) => r.from!.src!)

  const run = async () => {
    if (!provider) {
      setSettingsOpen(true)
      return
    }
    const model = node.model?.trim()
    const prompt = node.prompt?.trim()
    if (!model) {
      updateNode(node.id, { status: 'error', error: '请先填写模型名' })
      return
    }
    if (!prompt) {
      updateNode(node.id, { status: 'error', error: '请先填写提示词' })
      return
    }
    updateNode(node.id, { status: 'running', error: undefined, progress: undefined })
    const outPos = { x: node.x + node.width + 80, y: node.y }
    try {
      if (node.mode === 'text') {
        const text = await generateText(provider, model, prompt, refImages)
        const out = { id: uid(), type: 'text' as const, ...outPos, width: 360, height: 120, text }
        addNode(out, { history: false })
        addEdge({ id: uid(), from: node.id, to: out.id })
      } else if (node.mode === 'video') {
        const src = await generateVideo(provider, model, prompt, (msg) =>
          updateNode(node.id, { progress: msg }),
        )
        const { width, height } = await loadVideoMeta(src)
        const out = { id: uid(), type: 'video' as const, ...outPos, width, height, src, name: prompt.slice(0, 30) }
        addNode(out, { history: false })
        addEdge({ id: uid(), from: node.id, to: out.id })
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
        addNode(out, { history: false })
        addEdge({ id: uid(), from: node.id, to: out.id })
      } else {
        const src =
          refImages.length > 0
            ? await generateImageEdit(provider, model, prompt, refImages)
            : await generateImage(provider, model, prompt)
        const img = await loadImage(src)
        const { width, height } = fitSize(img.naturalWidth, img.naturalHeight)
        const out = { id: uid(), type: 'image' as const, ...outPos, width, height, src }
        addNode(out, { history: false })
        addEdge({ id: uid(), from: node.id, to: out.id })
      }
      updateNode(node.id, { status: 'idle', progress: undefined })
    } catch (e) {
      updateNode(node.id, {
        status: 'error',
        progress: undefined,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return (
    <div className="inspector">
      <h3>✦ AI 生成节点</h3>

      <label>生成类型</label>
      <div className="seg">
        {MODES.map((m) => (
          <button
            key={m}
            className={(node.mode ?? 'image') === m ? 'active' : ''}
            onClick={() => updateNode(node.id, { mode: m })}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <label>提供商</label>
      {providers.length === 0 ? (
        <button className="link" onClick={() => setSettingsOpen(true)}>
          还没有配置提供商，点这里去设置 →
        </button>
      ) : (
        <select
          value={provider?.id ?? ''}
          onChange={(e) => updateNode(node.id, { providerId: e.target.value })}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      <label>模型</label>
      <input
        list={`models-${provider?.id ?? 'none'}`}
        value={node.model ?? ''}
        placeholder={MODEL_PLACEHOLDER[node.mode ?? 'image']}
        onChange={(e) => updateNode(node.id, { model: e.target.value })}
      />
      {provider && (
        <datalist id={`models-${provider.id}`}>
          {provider.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}

      <label>参考图（{refEdges.length}）</label>
      {refEdges.length > 0 ? (
        <div className="ref-list">
          {refEdges.map((r) => (
            <div key={r.edge.id} className="ref-item">
              <img src={r.from!.src} alt="" />
              <button title="移除这张参考图" onClick={() => removeEdge(r.edge.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">悬停图片卡片，从右侧圆点拖一条线连到本节点，即可作为参考图。</p>
      )}
      {refEdges.length > 0 && node.mode === 'image' && (
        <p className="hint">将走以图生图接口（/images/edits）。</p>
      )}
      {refEdges.length > 0 && node.mode === 'text' && (
        <p className="hint">参考图会作为视觉输入发给多模态模型。</p>
      )}
      {refEdges.length > 0 && (node.mode === 'video' || node.mode === 'audio') && (
        <p className="hint">⚠ 视频/音频生成暂不使用参考图，本次将忽略。</p>
      )}

      {node.mode === 'audio' && (
        <>
          <label>音色（voice）</label>
          <input
            value={node.voice ?? ''}
            placeholder="alloy（默认）/ nova / echo …"
            onChange={(e) => updateNode(node.id, { voice: e.target.value })}
          />
        </>
      )}

      <label>{node.mode === 'audio' ? '朗读文本' : '提示词'}</label>
      <textarea
        rows={7}
        value={node.prompt ?? ''}
        placeholder={node.mode === 'audio' ? '输入要转成语音的文字…' : '描述你想生成的内容…'}
        onChange={(e) => updateNode(node.id, { prompt: e.target.value })}
      />

      <button className="primary" disabled={node.status === 'running'} onClick={() => void run()}>
        {node.status === 'running' ? '生成中…' : '生成'}
      </button>

      {node.status === 'error' && <p className="error">{node.error}</p>}
      <p className="hint">结果会作为新卡片出现在节点右侧，并用虚线记录生成来源。</p>
    </div>
  )
}
