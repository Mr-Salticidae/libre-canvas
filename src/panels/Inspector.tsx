import { useStore } from '../store'
import { useProviders } from '../providers'
import { useUI } from '../ui'
import { uid } from '../types'
import { generateImage, generateText } from '../api/openai'
import { fitSize, loadImage } from '../helpers'

/** 右侧属性面板：选中单个生成节点时出现 */
export function Inspector() {
  const selection = useStore((s) => s.selection)
  const nodes = useStore((s) => s.nodes)
  const updateNode = useStore((s) => s.updateNode)
  const addNode = useStore((s) => s.addNode)
  const addEdge = useStore((s) => s.addEdge)
  const providers = useProviders((s) => s.providers)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)

  const node = selection.length === 1 ? nodes[selection[0]] : undefined
  if (!node || node.type !== 'generator') return null

  const provider = providers.find((p) => p.id === node.providerId) ?? providers[0]

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
    updateNode(node.id, { status: 'running', error: undefined })
    try {
      if (node.mode === 'text') {
        const text = await generateText(provider, model, prompt)
        const out = {
          id: uid(),
          type: 'text' as const,
          x: node.x + node.width + 80,
          y: node.y,
          width: 360,
          height: 120,
          text,
        }
        addNode(out, { history: false })
        addEdge({ id: uid(), from: node.id, to: out.id })
      } else {
        const src = await generateImage(provider, model, prompt)
        const img = await loadImage(src)
        const { width, height } = fitSize(img.naturalWidth, img.naturalHeight)
        const out = { id: uid(), type: 'image' as const, x: node.x + node.width + 80, y: node.y, width, height, src }
        addNode(out, { history: false })
        addEdge({ id: uid(), from: node.id, to: out.id })
      }
      updateNode(node.id, { status: 'idle' })
    } catch (e) {
      updateNode(node.id, { status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="inspector">
      <h3>✦ AI 生成节点</h3>

      <label>生成类型</label>
      <div className="seg">
        <button
          className={node.mode !== 'text' ? 'active' : ''}
          onClick={() => updateNode(node.id, { mode: 'image' })}
        >
          图像
        </button>
        <button
          className={node.mode === 'text' ? 'active' : ''}
          onClick={() => updateNode(node.id, { mode: 'text' })}
        >
          文本
        </button>
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
        placeholder="如 gpt-image-1 / deepseek-chat"
        onChange={(e) => updateNode(node.id, { model: e.target.value })}
      />
      {provider && (
        <datalist id={`models-${provider.id}`}>
          {provider.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}

      <label>提示词</label>
      <textarea
        rows={7}
        value={node.prompt ?? ''}
        placeholder="描述你想生成的内容…"
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
