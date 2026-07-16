import { useEffect, useRef, useState } from 'react'
import { Layer, Line, Rect, Stage } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useStore } from '../store'
import { useUI } from '../ui'
import { uid } from '../types'
import { importFilesToCanvas } from '../importFiles'
import { usePalette } from '../theme'
import { AudioNode, GenNode, ImageNode, TextNode, VideoNode } from './nodes'

export function createGeneratorNode(x: number, y: number) {
  return {
    id: uid(),
    type: 'generator' as const,
    x,
    y,
    width: 260,
    height: 150,
    prompt: '',
    mode: 'image' as const,
    status: 'idle' as const,
  }
}

export function CanvasStage() {
  const pal = usePalette()
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const selection = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)
  const addNode = useStore((s) => s.addNode)
  const updateNode = useStore((s) => s.updateNode)
  const camera = useUI((s) => s.camera)
  const setCamera = useUI((s) => s.setCamera)
  const editingId = useUI((s) => s.editingId)
  const setEditingId = useUI((s) => s.setEditingId)
  const connecting = useUI((s) => s.connecting)
  const setConnecting = useUI((s) => s.setConnecting)
  const guides = useUI((s) => s.guides)
  const [spaceDown, setSpaceDown] = useState(false)
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const justMarqueed = useRef(false)

  // 空格按住 = 平移模式
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t as HTMLElement)?.isContentEditable
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // dev 调试口：控制台可查 stage 与 store
  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__lc = { stage: stageRef, useStore, useUI }
    }
  }, [])

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const oldScale = camera.scale
    const scaleBy = 1.06
    const next = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy
    const scale = Math.min(4, Math.max(0.08, next))
    const worldX = (pointer.x - camera.x) / oldScale
    const worldY = (pointer.y - camera.y) / oldScale
    setCamera({ x: pointer.x - worldX * scale, y: pointer.y - worldY * scale, scale })
  }

  const onStageClick = (e: KonvaEventObject<MouseEvent>) => {
    // 框选结束时 Konva 仍会补发一次 click，别让它清掉刚框中的选择
    if (justMarqueed.current) {
      justMarqueed.current = false
      return
    }
    if (e.target === stageRef.current) setSelection([])
  }

  const onStageDblClick = (e: KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current
    if (!stage || e.target !== stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const x = (pointer.x - camera.x) / camera.scale
    const y = (pointer.y - camera.y) / camera.scale
    const node = createGeneratorNode(x - 130, y - 75)
    addNode(node)
    setSelection([node.id])
    useUI.getState().requestPromptFocus()
  }

  const pointerWorld = () => {
    const stage = stageRef.current
    const p = stage?.getPointerPosition()
    if (!p) return null
    return { x: (p.x - camera.x) / camera.scale, y: (p.y - camera.y) / camera.scale }
  }

  const onStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (e.target !== stageRef.current || spaceDown || connecting || e.evt.button !== 0) return
    const w = pointerWorld()
    if (w) setMarquee({ x1: w.x, y1: w.y, x2: w.x, y2: w.y })
  }

  const onStageMouseMove = () => {
    if (marquee) {
      const w = pointerWorld()
      if (w) setMarquee({ ...marquee, x2: w.x, y2: w.y })
      return
    }
    if (!connecting) return
    const w = pointerWorld()
    if (w) setConnecting({ ...connecting, x: w.x, y: w.y })
  }

  const onStageMouseUp = () => {
    if (marquee) {
      const x = Math.min(marquee.x1, marquee.x2)
      const y = Math.min(marquee.y1, marquee.y2)
      const w = Math.abs(marquee.x2 - marquee.x1)
      const h = Math.abs(marquee.y2 - marquee.y1)
      if (w > 4 || h > 4) {
        const hit = Object.values(nodes)
          .filter((n) => n.x < x + w && n.x + n.width > x && n.y < y + h && n.y + n.height > y)
          .map((n) => n.id)
        setSelection(hit)
        justMarqueed.current = true
      }
      setMarquee(null)
      return
    }
    if (!connecting) return
    const w = pointerWorld()
    if (w) {
      const target = Object.values(nodes).find(
        (n) =>
          n.type === 'generator' &&
          w.x >= n.x &&
          w.x <= n.x + n.width &&
          w.y >= n.y &&
          w.y <= n.y + n.height,
      )
      const s = useStore.getState()
      if (
        target &&
        target.id !== connecting.fromId &&
        !s.edges.some((e) => e.from === connecting.fromId && e.to === target.id)
      ) {
        s.snapshot()
        s.addEdge({ id: uid(), from: connecting.fromId, to: target.id })
        setSelection([target.id])
      }
    }
    setConnecting(null)
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const w = { x: (e.clientX - camera.x) / camera.scale, y: (e.clientY - camera.y) / camera.scale }
    // 几何命中：插入顺序靠后 = 渲染在上层，取最后一个命中的
    const hits = Object.values(nodes).filter(
      (n) => w.x >= n.x && w.x <= n.x + n.width && w.y >= n.y && w.y <= n.y + n.height,
    )
    const hit = hits[hits.length - 1]
    if (hit) {
      const sel = useStore.getState().selection
      if (!sel.includes(hit.id)) {
        const ids = hit.groupId
          ? Object.values(nodes).filter((n) => n.groupId === hit.groupId).map((n) => n.id)
          : [hit.id]
        setSelection(ids)
      }
    }
    useUI.getState().setContextMenu({ x: e.clientX, y: e.clientY, nodeId: hit?.id })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const x = (e.clientX - camera.x) / camera.scale
    const y = (e.clientY - camera.y) / camera.scale
    void importFilesToCanvas(files, { x, y })
  }

  const editingNode = editingId ? nodes[editingId] : null

  const nodeList = Object.values(nodes)

  return (
    <div
      className="canvas-root"
      style={{ cursor: spaceDown ? 'grab' : undefined }}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      onContextMenu={onContextMenu}
    >
      {nodeList.length === 0 && (
        <div className="canvas-empty">
          <p className="kicker">Libre Canvas · BYOK</p>
          <h1>自由画布</h1>
          <p>
            把图片、视频、音频、文字拖进来，或<kbd>双击</kbd>画布创建生成节点。
            <br />
            自己的 key，自己的画布——一切都只发生在你的浏览器里。
          </p>
        </div>
      )}
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={camera.x}
        y={camera.y}
        scaleX={camera.scale}
        scaleY={camera.scale}
        draggable={spaceDown && !connecting}
        onWheel={onWheel}
        onClick={onStageClick}
        onDblClick={onStageDblClick}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setCamera({ ...camera, x: e.target.x(), y: e.target.y() })
          }
        }}
      >
        <Layer>
          {edges.map((edge) => {
            const from = nodes[edge.from]
            const to = nodes[edge.to]
            if (!from || !to) return null
            const x1 = from.x + from.width
            const y1 = from.y + from.height / 2
            const x2 = to.x
            const y2 = to.y + to.height / 2
            const dx = Math.max(40, Math.abs(x2 - x1) / 2)
            // 指向生成节点的是参考输入（实线高亮），其余是生成输出（虚线）
            const isInput = to.type === 'generator'
            return (
              <Line
                key={edge.id}
                points={[x1, y1, x1 + dx, y1, x2 - dx, y2, x2, y2]}
                bezier
                stroke={isInput ? pal.accent : pal.inkSoft}
                strokeWidth={isInput ? 2 : 1.5}
                dash={isInput ? undefined : [6, 4]}
                opacity={isInput ? 0.85 : 0.55}
                listening={false}
              />
            )
          })}
          {guides &&
            (() => {
              const x0 = (0 - camera.x) / camera.scale
              const x1 = (size.w - camera.x) / camera.scale
              const y0 = (0 - camera.y) / camera.scale
              const y1 = (size.h - camera.y) / camera.scale
              return (
                <>
                  {guides.v !== undefined && (
                    <Line
                      points={[guides.v, y0, guides.v, y1]}
                      stroke={pal.accent2}
                      strokeWidth={1}
                      strokeScaleEnabled={false}
                      dash={[4, 4]}
                      listening={false}
                    />
                  )}
                  {guides.h !== undefined && (
                    <Line
                      points={[x0, guides.h, x1, guides.h]}
                      stroke={pal.accent2}
                      strokeWidth={1}
                      strokeScaleEnabled={false}
                      dash={[4, 4]}
                      listening={false}
                    />
                  )}
                </>
              )
            })()}
          {marquee && (
            <Rect
              x={Math.min(marquee.x1, marquee.x2)}
              y={Math.min(marquee.y1, marquee.y2)}
              width={Math.abs(marquee.x2 - marquee.x1)}
              height={Math.abs(marquee.y2 - marquee.y1)}
              fill={pal.accent + '1a'}
              stroke={pal.accent}
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
          )}
          {connecting &&
            (() => {
              const from = nodes[connecting.fromId]
              if (!from) return null
              const x1 = from.x + from.width
              const y1 = from.y + from.height / 2
              const dx = Math.max(40, Math.abs(connecting.x - x1) / 2)
              return (
                <Line
                  points={[x1, y1, x1 + dx, y1, connecting.x - dx, connecting.y, connecting.x, connecting.y]}
                  bezier
                  stroke={pal.accent}
                  strokeWidth={2}
                  dash={[4, 4]}
                  listening={false}
                />
              )
            })()}
          {nodeList.map((node) => {
            const selected = selection.includes(node.id)
            if (node.type === 'image') return <ImageNode key={node.id} node={node} selected={selected} />
            if (node.type === 'video') return <VideoNode key={node.id} node={node} selected={selected} />
            if (node.type === 'audio') return <AudioNode key={node.id} node={node} selected={selected} />
            if (node.type === 'text') return <TextNode key={node.id} node={node} selected={selected} />
            return <GenNode key={node.id} node={node} selected={selected} />
          })}
        </Layer>
      </Stage>

      {editingNode && (
        <textarea
          ref={(el) => el?.focus()}
          defaultValue={editingNode.text ?? ''}
          style={{
            position: 'absolute',
            left: editingNode.x * camera.scale + camera.x,
            top: editingNode.y * camera.scale + camera.y,
            width: editingNode.width * camera.scale,
            minHeight: editingNode.height * camera.scale,
            background: 'var(--paper-2)',
            color: 'var(--ink)',
            border: '2px solid var(--accent)',
            borderRadius: 10,
            padding: 12,
            fontSize: 14 * camera.scale,
            lineHeight: 1.6,
            resize: 'none',
            outline: 'none',
            zIndex: 20,
          }}
          onBlur={(e) => {
            useStore.getState().snapshot()
            updateNode(editingNode.id, { text: e.target.value })
            setEditingId(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }}
        />
      )}
    </div>
  )
}
