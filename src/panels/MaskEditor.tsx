import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useProviders } from '../providers'
import { useUI } from '../ui'
import { uid, type CanvasNode } from '../types'
import { generateImageInpaint } from '../api/openai'
import { fitSize, loadImage } from '../helpers'

export function MaskEditor() {
  const id = useUI((s) => s.maskEditingId)
  const node = useStore((s) => (id ? s.nodes[id] : undefined))
  if (!id || !node || node.type !== 'image' || !node.src) return null
  return <MaskEditorInner key={id} node={node} />
}

function MaskEditorInner({ node }: { node: CanvasNode }) {
  const setMaskEditingId = useUI((s) => s.setMaskEditingId)
  const providers = useProviders((s) => s.providers)
  const addNode = useStore((s) => s.addNode)
  const addEdge = useStore((s) => s.addEdge)

  const [img, setImg] = useState<HTMLImageElement>()
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '')
  const [model, setModel] = useState('gpt-image-1')
  const [prompt, setPrompt] = useState('')
  const [brush, setBrush] = useState(48)
  const [erasing, setErasing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const maskRef = useRef<HTMLCanvasElement>(null)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    loadImage(node.src!)
      .then(setImg)
      .catch(() => setError('图片加载失败'))
  }, [node.src])

  if (!img) {
    return (
      <div className="modal-mask">
        <div className="modal">{error ?? '加载图片…'}</div>
      </div>
    )
  }

  const natW = img.naturalWidth
  const natH = img.naturalHeight
  // 显示尺寸：适配视口
  const disp = fitSize(natW, natH, Math.min(window.innerWidth - 420, window.innerHeight - 200, 720))
  const scaleX = natW / disp.width
  const scaleY = natH / disp.height

  const toCanvasPoint = (e: React.PointerEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  const paint = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = maskRef.current?.getContext('2d')
    if (!ctx) return
    // 全不透明作画（半透明显示交给 CSS opacity），确保 buildMask 时涂抹区 alpha 归零
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    ctx.strokeStyle = 'rgb(255, 64, 96)'
    ctx.lineWidth = brush * scaleX
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }

  const onPointerDown = (e: React.PointerEvent) => {
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // 合成事件没有活动指针，忽略
    }
    const p = toCanvasPoint(e)
    lastPoint.current = p
    paint(p, { x: p.x + 0.01, y: p.y + 0.01 })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!lastPoint.current) return
    const p = toCanvasPoint(e)
    paint(lastPoint.current, p)
    lastPoint.current = p
  }

  const onPointerUp = () => {
    lastPoint.current = null
  }

  const clearMask = () => {
    maskRef.current?.getContext('2d')?.clearRect(0, 0, natW, natH)
  }

  const hasPaint = (): boolean => {
    const ctx = maskRef.current?.getContext('2d')
    if (!ctx) return false
    const d = ctx.getImageData(0, 0, natW, natH).data
    for (let i = 3; i < d.length; i += 16) if (d[i] > 0) return true
    return false
  }

  /** 涂抹处 → 透明（OpenAI 规范：mask 全透明区域 = 允许重绘） */
  const buildMask = (): string => {
    const mc = document.createElement('canvas')
    mc.width = natW
    mc.height = natH
    const ctx = mc.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, natW, natH)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(maskRef.current!, 0, 0)
    return mc.toDataURL('image/png')
  }

  const run = async () => {
    const provider = providers.find((p) => p.id === providerId) ?? providers[0]
    if (!provider) {
      setError('请先在设置里添加提供商')
      return
    }
    if (!model.trim()) {
      setError('请填写模型名')
      return
    }
    if (!prompt.trim()) {
      setError('请描述重绘区域要变成什么')
      return
    }
    if (!hasPaint()) {
      setError('请先用画笔涂抹要重绘的区域')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const src = await generateImageInpaint(provider, model.trim(), prompt.trim(), node.src!, buildMask())
      const out = await loadImage(src)
      const { width, height } = fitSize(out.naturalWidth, out.naturalHeight)
      const outNode = {
        id: uid(),
        type: 'image' as const,
        x: node.x + node.width + 80,
        y: node.y,
        width,
        height,
        src,
        name: `重绘·${prompt.slice(0, 20)}`,
      }
      addNode(outNode)
      addEdge({ id: uid(), from: node.id, to: outNode.id })
      useStore.getState().setSelection([outNode.id])
      setMaskEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const provider = providers.find((p) => p.id === providerId) ?? providers[0]

  return (
    <div className="modal-mask">
      <div className="mask-editor">
        <div className="mask-canvas-col">
          <div className="mask-canvas-wrap" style={{ width: disp.width, height: disp.height }}>
            <img src={node.src} alt="" draggable={false} />
            <canvas
              ref={maskRef}
              width={natW}
              height={natH}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            />
          </div>
          <div className="mask-tools">
            <button className={!erasing ? 'active' : ''} onClick={() => setErasing(false)}>
              🖌 画笔
            </button>
            <button className={erasing ? 'active' : ''} onClick={() => setErasing(true)}>
              ⌫ 擦除
            </button>
            <label>
              笔刷 {brush}px
              <input
                type="range"
                min={8}
                max={160}
                value={brush}
                onChange={(e) => setBrush(Number(e.target.value))}
              />
            </label>
            <button onClick={clearMask}>清空</button>
          </div>
        </div>

        <div className="mask-side">
          <h3>🖌 局部重绘</h3>
          <p className="hint">涂抹要重新生成的区域（红色），其余部分保持不变。</p>

          <label>提供商</label>
          <select value={provider?.id ?? ''} onChange={(e) => setProviderId(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <label>模型（需支持 images/edits + mask）</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-image-1" />

          <label>重绘区域要变成什么？</label>
          <textarea
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="如：换成一顶红色贝雷帽"
          />

          <button className="primary" disabled={busy} onClick={() => void run()}>
            {busy ? '重绘中…' : '生成'}
          </button>
          {error && <p className="error">{error}</p>}
          <button onClick={() => setMaskEditingId(null)}>取消</button>
        </div>
      </div>
    </div>
  )
}
