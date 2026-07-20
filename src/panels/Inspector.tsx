import { useEffect, useState } from 'react'
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
  listModels,
} from '../api/openai'
import { fitSize, loadImage, loadVideoMeta } from '../helpers'
import { iterateFromNode } from '../branch'
import { MODE_LABEL } from '../canvas/nodes'

const MODES: GenMode[] = ['image', 'text', 'video', 'audio']

const MODEL_PLACEHOLDER: Record<GenMode, string> = {
  image: '如 gpt-image-1',
  text: '如 gpt-4o-mini / deepseek-chat',
  video: '如 sora-2',
  audio: '如 gpt-4o-mini-tts / tts-1',
}

/** 浮动面板：跟随选中节点，出现在节点下方；放不下则翻到上方（bottom 锚定，无需精确估高） */
function floatStyle(
  node: { x: number; y: number; width: number; height: number },
  camera: { x: number; y: number; scale: number },
  panelW: number,
  estH: number,
): React.CSSProperties {
  const sx = node.x * camera.scale + camera.x
  const sy = node.y * camera.scale + camera.y
  const nodeW = node.width * camera.scale
  const nodeH = node.height * camera.scale
  let left = sx + nodeW / 2 - panelW / 2
  left = Math.max(12, Math.min(left, window.innerWidth - panelW - 12))
  const below = sy + nodeH + 14
  if (below + estH <= window.innerHeight - 12) {
    return { left, top: below, width: panelW }
  }
  // 贴着节点上缘向上展开
  return { left, bottom: Math.max(12, window.innerHeight - sy + 14), width: panelW }
}

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
  const camera = useUI((s) => s.camera)
  const promptFocusTick = useUI((s) => s.promptFocusTick)
  const [atOpen, setAtOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  // 从 /models 拉到的真实模型列表，按提供商缓存（预设里的模型名未必对得上账号实际可用）
  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({})
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string>()

  // 点菜单外的任何地方都收起模型下拉
  useEffect(() => {
    if (!modelOpen) return
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('.model-field') && !t.closest('.model-menu')) setModelOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [modelOpen])

  // 双击生成节点 → 聚焦提示词框（光标落到末尾）
  useEffect(() => {
    if (promptFocusTick === 0) return
    const ta = document.querySelector<HTMLTextAreaElement>('.inspector .prompt-wrap textarea')
    if (ta) {
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    }
  }, [promptFocusTick])

  const node = selection.length === 1 ? nodes[selection[0]] : undefined

  if (node && node.type !== 'generator') {
    const download = node.src && (
      <button
        onClick={() => {
          const a = document.createElement('a')
          a.href = node.src!
          a.download = node.name || `librecanvas-${node.type}`
          a.click()
        }}
      >
        ⤓ 下载
      </button>
    )
    const iterate = (
      <button
        className="primary"
        title="以这张卡为参考开新分支（不覆盖原结果）"
        onClick={() => iterateFromNode(node)}
      >
        ✦ 迭代
      </button>
    )
    let actions: React.ReactNode = null
    let barW = 120
    if (node.type === 'image' && node.src) {
      barW = 300
      actions = (
        <>
          {iterate}
          <button onClick={() => useUI.getState().setMaskEditingId(node.id)}>🖌 局部重绘</button>
          {download}
        </>
      )
    } else if ((node.type === 'video' || node.type === 'audio') && node.src) {
      actions = download
    } else if (node.type === 'text') {
      barW = 176
      actions = (
        <>
          {iterate}
          <button onClick={() => useUI.getState().setEditingId(node.id)}>✎ 编辑</button>
        </>
      )
    }
    if (!actions) return null
    return (
      <div className="node-bar" style={floatStyle(node, camera, barW, 48)}>
        {actions}
      </div>
    )
  }

  if (!node || node.type !== 'generator') return null

  const provider = providers.find((p) => p.id === node.providerId) ?? providers[0]

  // 参考输入：指向本节点的边（图片 = 参考图，文本 = 引用资料，视频/音频 = 视频生成的参考素材）
  const refEdges = edges
    .map((e) => ({ edge: e, from: nodes[e.from] }))
    .filter(
      (r) =>
        r.edge.to === node.id &&
        (((r.from?.type === 'image' || r.from?.type === 'video' || r.from?.type === 'audio') && r.from.src) ||
          (r.from?.type === 'text' && r.from.text?.trim())),
    )
  const imageRefs = refEdges.filter((r) => r.from!.type === 'image')
  const textRefs = refEdges.filter((r) => r.from!.type === 'text')
  const videoRefs = refEdges.filter((r) => r.from!.type === 'video')
  const audioRefs = refEdges.filter((r) => r.from!.type === 'audio')
  const refImages = imageRefs.map((r) => r.from!.src!)

  // @ 引用候选：画布上可作为参考的其它卡片（未连过的图片/文本；视频模式下加上视频/音频）
  const atCandidates = Object.values(nodes).filter(
    (n) =>
      n.id !== node.id &&
      ((n.type === 'image' && n.src) ||
        (n.type === 'text' && n.text?.trim()) ||
        (node.mode === 'video' && (n.type === 'video' || n.type === 'audio') && n.src)) &&
      !edges.some((e) => e.from === n.id && e.to === node.id),
  )

  // 模型列表按「提供商 + 模式」缓存：同一家的文本/图片/视频模型是不同的集合
  const modelsKey = provider ? `${provider.id}:${node.mode ?? 'image'}` : ''

  const loadModels = async (p: typeof provider) => {
    if (!p) return
    setModelsLoading(true)
    setModelsError(undefined)
    try {
      const list = await listModels(p, node.mode ?? 'image')
      setFetchedModels((prev) => ({ ...prev, [modelsKey]: list }))
      if (list.length === 0) setModelsError('接口没有返回任何模型')
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e))
    } finally {
      setModelsLoading(false)
    }
  }

  // 「常用模型」是设置里配的一份通用列表，不区分模式（文本/图片/视频共用同一份）。
  // 一旦按当前模式实拉过（fetched 有值，服务端已按 type 过滤），就只信实拉结果，
  // 否则别的模式配的模型（如文本模型）会混进视频列表；没拉过时才拿它垫底展示。
  const fetched = provider ? fetchedModels[modelsKey] : undefined
  const allModels = fetched ?? provider?.models ?? []
  const query = (node.model ?? '').trim().toLowerCase()
  const modelOptions =
    query && !allModels.some((m) => m.toLowerCase() === query)
      ? allModels.filter((m) => m.toLowerCase().includes(query))
      : allModels

  const addRef = (fromId: string) => {
    useStore.getState().snapshot()
    addEdge({ id: uid(), from: fromId, to: node.id })
  }

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
    // 文本引用作为上下文并入提示词（TTS 朗读原文，不并入）
    const refTextContents = textRefs.map((r) => r.from!.text!.trim())
    const fullPrompt =
      refTextContents.length > 0 && node.mode !== 'audio'
        ? `${prompt}\n\n【引用资料】\n${refTextContents.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
        : prompt

    updateNode(node.id, { status: 'running', error: undefined, progress: undefined })
    const outPos = { x: node.x + node.width + 80, y: node.y }
    try {
      if (node.mode === 'text') {
        const text = await generateText(provider, model, fullPrompt, refImages)
        const out = { id: uid(), type: 'text' as const, ...outPos, width: 360, height: 120, text }
        addNode(out, { history: false })
        addEdge({ id: uid(), from: node.id, to: out.id })
      } else if (node.mode === 'video') {
        const refs = {
          images: refImages,
          videos: videoRefs.map((r) => r.from!.src!),
          audios: audioRefs.map((r) => r.from!.src!),
        }
        const src = await generateVideo(provider, model, fullPrompt, refs, (msg) =>
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
            ? await generateImageEdit(provider, model, fullPrompt, refImages)
            : await generateImage(provider, model, fullPrompt)
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
    <div className="inspector" style={floatStyle(node, camera, 340, 430)}>
      <h3>✦ AI 生成节点</h3>

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

      <label>提供商 / 模型</label>
      {providers.length === 0 ? (
        <button className="link" onClick={() => setSettingsOpen(true)}>
          还没有配置提供商，点这里去设置 →
        </button>
      ) : (
        <div className="row2">
          <select
            value={provider?.id ?? ''}
            onChange={(e) => {
              // 模型名是提供商专属的，换商必须清掉，否则会拿旧模型去请求新接口
              const next = providers.find((p) => p.id === e.target.value)
              updateNode(node.id, {
                providerId: e.target.value,
                model: next?.models[0] ?? '',
                status: undefined,
                error: undefined,
              })
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="model-field">
            <input
              value={node.model ?? ''}
              placeholder={MODEL_PLACEHOLDER[node.mode ?? 'image']}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => updateNode(node.id, { model: e.target.value })}
              onFocus={() => setModelOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setModelOpen(false)
              }}
            />
            <button
              className="model-toggle"
              title="选择模型"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const next = !modelOpen
                setModelOpen(next)
                // 首次展开自动拉一次真实列表，省得用户再点一下
                if (next && provider && !fetchedModels[modelsKey] && !modelsLoading) {
                  void loadModels(provider)
                }
              }}
            >
              ▾
            </button>
          </div>
          {modelOpen && provider && (
            <div className="model-menu">
              <div className="model-menu-head">
                <span>
                  {modelOptions.length} 个{MODE_LABEL[node.mode ?? 'image']}模型
                  {fetchedModels[modelsKey] ? '（来自接口）' : ''}
                </span>
                <button
                  className="link"
                  disabled={modelsLoading}
                  onClick={() => void loadModels(provider)}
                >
                  {modelsLoading ? '拉取中…' : '⟳ 拉取可用模型'}
                </button>
              </div>
              {modelsError && <p className="hint error">{modelsError}</p>}
              {modelOptions.length === 0 && !modelsLoading && (
                <p className="hint">没有模型可选，点上方「拉取可用模型」，或直接在输入框手输模型名。</p>
              )}
              {modelOptions.map((m) => (
                <button
                  key={m}
                  className={m === node.model ? 'active' : ''}
                  title={m}
                  onClick={() => {
                    updateNode(node.id, { model: m })
                    setModelOpen(false)
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <label>引用（{refEdges.length}）</label>
      {refEdges.length > 0 ? (
        <>
          {imageRefs.length > 0 && (
            <div className="ref-list">
              {imageRefs.map((r) => (
                <div key={r.edge.id} className="ref-item">
                  <img src={r.from!.src} alt="" />
                  <button title="移除这张参考图" onClick={() => removeEdge(r.edge.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {textRefs.map((r) => (
            <div key={r.edge.id} className="ref-text">
              <span>📄 {(r.from!.name || r.from!.text!).slice(0, 22)}</span>
              <button title="移除这条引用" onClick={() => removeEdge(r.edge.id)}>
                ✕
              </button>
            </div>
          ))}
          {[...videoRefs, ...audioRefs].map((r) => (
            <div key={r.edge.id} className="ref-text">
              <span>
                {r.from!.type === 'video' ? '🎬' : '🎵'} {(r.from!.name || '未命名').slice(0, 22)}
              </span>
              <button title="移除这条参考" onClick={() => removeEdge(r.edge.id)}>
                ✕
              </button>
            </div>
          ))}
        </>
      ) : (
        <p className="hint">在提示词里输入 @ 引用画布卡片，或从卡片右侧圆点拖线连到本节点。</p>
      )}
      {imageRefs.length > 0 && node.mode === 'image' && (
        <p className="hint">参考图将走以图生图接口（/images/edits）。</p>
      )}
      {imageRefs.length > 0 && node.mode === 'text' && (
        <p className="hint">参考图会作为视觉输入发给多模态模型。</p>
      )}
      {node.mode === 'video' && refEdges.length > 0 && (
        <p className="hint">
          参考素材按连线顺序编号，提示词里用「图片1」「视频1」「音频1」指代（火山方舟 Seedance 全支持；硅基流动仅用首张图作首帧）。
        </p>
      )}
      {(imageRefs.length > 0 || videoRefs.length > 0 || audioRefs.length > 0) && node.mode === 'audio' && (
        <p className="hint">⚠ 音频生成不使用参考素材，本次将忽略。</p>
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
      <div className="prompt-wrap">
        <textarea
          rows={3}
          value={node.prompt ?? ''}
          placeholder={node.mode === 'audio' ? '输入要转成语音的文字…' : '描述你想生成的内容…（@ 引用画布卡片）'}
          onChange={(e) => updateNode(node.id, { prompt: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === '@') setAtOpen(true)
            else if (e.key === 'Escape') setAtOpen(false)
          }}
          onBlur={() => setTimeout(() => setAtOpen(false), 200)}
        />
        {atOpen && (
          <div className="at-menu">
            {atCandidates.length === 0 && <p className="hint">画布上没有可引用的图片/文本卡片</p>}
            {atCandidates.slice(0, 8).map((c) => (
              <button
                key={c.id}
                onMouseDown={(e) => {
                  e.preventDefault()
                  // 吃掉刚敲下的 @，把卡片转成结构化引用
                  updateNode(node.id, { prompt: (node.prompt ?? '').replace(/@$/, '') })
                  addRef(c.id)
                  setAtOpen(false)
                }}
              >
                {c.type === 'image' ? '🖼' : c.type === 'video' ? '🎬' : c.type === 'audio' ? '🎵' : '📄'}{' '}
                {(c.name || c.text || '未命名').slice(0, 26)}
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="primary" disabled={node.status === 'running'} onClick={() => void run()}>
        {node.status === 'running' ? '生成中…' : '生成'}
      </button>

      {node.status === 'error' && <p className="error">{node.error}</p>}
    </div>
  )
}
