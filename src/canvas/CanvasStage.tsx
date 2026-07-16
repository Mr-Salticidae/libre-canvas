import { useEffect, useRef, useState } from 'react'
import { Layer, Line, Stage } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useStore } from '../store'
import { useUI } from '../ui'
import { uid } from '../types'
import { importFilesToCanvas } from '../importFiles'
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
  }

  const pointerWorld = () => {
    const stage = stageRef.current
    const p = stage?.getPointerPosition()
    if (!p) return null
    return { x: (p.x - camera.x) / camera.scale, y: (p.y - camera.y) / camera.scale }
  }

  const onStageMouseMove = () => {
    if (!connecting) return
    const w = pointerWorld()
    if (w) setConnecting({ ...connecting, x: w.x, y: w.y })
  }

  const onStageMouseUp = () => {
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
      style={{ position: 'fixed', inset: 0, background: '#131318' }}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={camera.x}
        y={camera.y}
        scaleX={camera.scale}
        scaleY={camera.scale}
        draggable={!connecting}
        onWheel={onWheel}
        onClick={onStageClick}
        onDblClick={onStageDblClick}
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
                stroke={isInput ? '#7c5cff' : '#5a5a78'}
                strokeWidth={isInput ? 2 : 1.5}
                dash={isInput ? undefined : [6, 4]}
                opacity={isInput ? 0.9 : 1}
                listening={false}
              />
            )
          })}
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
                  stroke="#7c5cff"
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
            background: '#1e1e28',
            color: '#e6e6f0',
            border: '2px solid #7c5cff',
            borderRadius: 8,
            padding: 10,
            fontSize: 14 * camera.scale,
            lineHeight: 1.5,
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
