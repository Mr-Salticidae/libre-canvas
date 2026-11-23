import { useState } from 'react'
import { useStore } from '../store'
import { useProviders } from '../providers'
import { useUI, viewportCenter } from '../ui'
import { uid } from '../types'
import { presetIds } from '../api/comfyui'
import { runGenerator } from '../generate'

/**
 * 底部常驻提示词栏（对齐即梦：画布底部直接写提示词、回车就生成）。
 *
 * 三种状态：
 *  - 选中生成节点 → 直接编辑它的提示词，回车生成
 *  - 没选节点   → 当草稿，回车在视口中央新建一个生成节点并立刻跑
 *  - 选中媒体卡 → 提示词栏隐藏（避免误以为能改图）
 */
export function PromptBar() {
  const selection = useStore((s) => s.selection)
  const nodes = useStore((s) => s.nodes)
  const updateNode = useStore((s) => s.updateNode)
  const addNode = useStore((s) => s.addNode)
  const setSelection = useStore((s) => s.setSelection)
  const providers = useProviders((s) => s.providers)
  const [draft, setDraft] = useState('')
  const [atOpen, setAtOpen] = useState(false)
  const edges = useStore((s) => s.edges)
  const addEdge = useStore((s) => s.addEdge)

  const selected = selection.length === 1 ? nodes[selection[0]] : undefined
  const target = selected?.type === 'generator' ? selected : undefined
  // 选中任何非生成卡（图片/视频/音频/文本）时隐藏，避免误以为能直接改它
  if (selected && selected.type !== 'generator') return null

  const value = target ? (target.prompt ?? '') : draft
  const busy = target?.status === 'running'
  const provider = target
    ? providers.find((p) => p.id === target.providerId) ?? providers[0]
    : providers[0]

  const setValue = (v: string) => {
    if (target) updateNode(target.id, { prompt: v })
    else setDraft(v)
  }

  const submit = async () => {
    const text = value.trim()
    if (!text || busy) return
    if (target) {
      await runGenerator(target.id)
      return
    }
    const c = viewportCenter(useUI.getState().camera)
    const node = {
      id: uid(),
      type: 'generator' as const,
      x: c.x - 130,
      y: c.y - 90,
      width: 260,
      height: 150,
      prompt: text,
      mode: 'image' as const,
      status: 'idle' as const,
      providerId: provider?.id,
      // 本地 ComfyUI 的模型是预设 id；云端取它的第一个模型
      model: provider?.kind === 'comfyui' ? presetIds('image')[0] : provider?.models[0],
    }
    addNode(node)
    setSelection([node.id])
    setDraft('')
    await runGenerator(node.id)
  }

  // @ 引用候选：画布上能当参考的卡片（未连过本节点的）
  const atCandidates = target
    ? Object.values(nodes).filter(
        (n) =>
          n.id !== target.id &&
          ((n.type === 'image' && n.src) ||
            (n.type === 'text' && n.text?.trim()) ||
            (target.mode === 'video' && (n.type === 'video' || n.type === 'audio') && n.src)) &&
          !edges.some((e) => e.from === n.id && e.to === target.id),
      )
    : []

  const mode = target?.mode ?? 'image'
  const hint = target
    ? `${mode === 'video' ? '视频' : mode === 'text' ? '文本' : mode === 'audio' ? '音频' : '图片'} · ${target.model ?? '未选模型'}`
    : providers.length === 0
      ? '还没配提供商（点右上角设置）'
      : `回车新建${provider?.kind === 'comfyui' ? '本地' : ''}生成节点`

  return (
    <div className="prompt-bar">
      <textarea
        value={value}
        rows={1}
        placeholder={target ? '描述你想要的画面，回车生成（Shift+回车换行）' : '直接在画布上新建：写提示词，回车生成'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          } else if (e.key === '@' && target) {
            setAtOpen(true)
          } else if (e.key === 'Escape') {
            setAtOpen(false)
          }
        }}
        onBlur={() => setTimeout(() => setAtOpen(false), 200)}
      />
      {atOpen && target && (
        <div className="at-menu">
          {atCandidates.length === 0 && <p className="hint">画布上没有可引用的图片/文本卡片</p>}
          {atCandidates.slice(0, 8).map((c) => (
            <button
              key={c.id}
              onMouseDown={(e) => {
                e.preventDefault()
                updateNode(target.id, { prompt: (target.prompt ?? '').replace(/@$/, '') })
                useStore.getState().snapshot()
                addEdge({ id: uid(), from: c.id, to: target.id })
                setAtOpen(false)
              }}
            >
              {c.type === 'image' ? '🖼' : c.type === 'video' ? '🎬' : c.type === 'audio' ? '🎵' : '📄'}{' '}
              {(c.name || c.text || '未命名').slice(0, 26)}
            </button>
          ))}
        </div>
      )}

      <div className="prompt-bar-foot">
        <span className="prompt-hint">{hint}</span>
        <button className="primary" disabled={busy || !value.trim()} onClick={() => void submit()}>
          {busy ? '生成中…' : '生成'}
        </button>
      </div>
    </div>
  )
}
