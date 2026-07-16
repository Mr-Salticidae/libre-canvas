import { useEffect, useRef, useState } from 'react'
import { Group, Image as KImage, Rect, Text } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { CanvasNode } from '../types'
import { useStore } from '../store'
import { useUI } from '../ui'

const ACCENT = '#7c5cff'
const CARD_BG = '#1e1e28'
const CARD_BORDER = '#34344a'

interface NodeProps {
  node: CanvasNode
  selected: boolean
}

/** 选择 + 拖拽的公共行为 */
function useNodeHandlers(node: CanvasNode) {
  const setSelection = useStore((s) => s.setSelection)
  const updateNode = useStore((s) => s.updateNode)
  const snapshot = useStore((s) => s.snapshot)

  return {
    onClick: (e: KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true
      const sel = useStore.getState().selection
      if (e.evt.shiftKey) {
        setSelection(sel.includes(node.id) ? sel.filter((i) => i !== node.id) : [...sel, node.id])
      } else {
        setSelection([node.id])
      }
    },
    onDragStart: (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true
      snapshot()
      const sel = useStore.getState().selection
      if (!sel.includes(node.id)) setSelection([node.id])
    },
    onDragMove: (e: KonvaEventObject<DragEvent>) => {
      updateNode(node.id, { x: e.target.x(), y: e.target.y() })
    },
  }
}

function useImage(src?: string) {
  const [img, setImg] = useState<HTMLImageElement>()
  useEffect(() => {
    if (!src) return
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => setImg(i)
    i.src = src
    return () => setImg(undefined)
  }, [src])
  return img
}

export function ImageNode({ node, selected }: NodeProps) {
  const img = useImage(node.src)
  const h = useNodeHandlers(node)
  return (
    <Group x={node.x} y={node.y} draggable {...h}>
      <Rect
        width={node.width}
        height={node.height}
        fill={CARD_BG}
        cornerRadius={8}
        stroke={selected ? ACCENT : CARD_BORDER}
        strokeWidth={selected ? 2.5 : 1}
        shadowColor="#000"
        shadowBlur={12}
        shadowOpacity={0.4}
      />
      {img ? (
        <KImage image={img} width={node.width} height={node.height} cornerRadius={8} />
      ) : (
        <Text
          text="加载图片…"
          width={node.width}
          height={node.height}
          align="center"
          verticalAlign="middle"
          fill="#8888a0"
          fontSize={13}
        />
      )}
      {selected && (
        <Rect
          width={node.width}
          height={node.height}
          cornerRadius={8}
          stroke={ACCENT}
          strokeWidth={2.5}
          listening={false}
        />
      )}
    </Group>
  )
}

export function TextNode({ node, selected }: NodeProps) {
  const h = useNodeHandlers(node)
  const updateNode = useStore((s) => s.updateNode)
  const setEditingId = useUI((s) => s.setEditingId)
  const textRef = useRef<Konva.Text>(null)

  // 文本渲染后按实际高度回写节点高度，让边框和连线锚点贴合内容
  useEffect(() => {
    const t = textRef.current
    if (!t) return
    const measured = Math.max(48, Math.round(t.height() + 24))
    if (Math.abs(measured - node.height) > 2) updateNode(node.id, { height: measured })
  }, [node.text, node.width, node.height, node.id, updateNode])

  return (
    <Group
      x={node.x}
      y={node.y}
      draggable
      {...h}
      onDblClick={(e) => {
        e.cancelBubble = true
        setEditingId(node.id)
      }}
    >
      <Rect
        width={node.width}
        height={node.height}
        fill={CARD_BG}
        cornerRadius={8}
        stroke={selected ? ACCENT : CARD_BORDER}
        strokeWidth={selected ? 2.5 : 1}
        shadowColor="#000"
        shadowBlur={12}
        shadowOpacity={0.4}
      />
      <Text
        ref={textRef}
        text={node.text || '双击编辑文本'}
        x={12}
        y={12}
        width={node.width - 24}
        fill={node.text ? '#e6e6f0' : '#8888a0'}
        fontSize={14}
        lineHeight={1.5}
      />
    </Group>
  )
}

export function GenNode({ node, selected }: NodeProps) {
  const h = useNodeHandlers(node)
  const statusText =
    node.status === 'running' ? '⏳ 生成中…' : node.status === 'error' ? `✕ ${node.error ?? '出错了'}` : ''
  const statusColor = node.status === 'error' ? '#ff6b6b' : '#f0a651'

  return (
    <Group x={node.x} y={node.y} draggable {...h}>
      <Rect
        width={node.width}
        height={node.height}
        fill="#232030"
        cornerRadius={10}
        stroke={selected ? ACCENT : '#453d66'}
        strokeWidth={selected ? 2.5 : 1.5}
        shadowColor="#000"
        shadowBlur={12}
        shadowOpacity={0.4}
      />
      <Text
        text={`✦ AI 生成 · ${node.mode === 'text' ? '文本' : '图像'}`}
        x={12}
        y={10}
        fill={ACCENT}
        fontSize={13}
        fontStyle="bold"
      />
      <Text
        text={node.prompt ? node.prompt.slice(0, 90) + (node.prompt.length > 90 ? '…' : '') : '选中后在右侧面板填写提示词'}
        x={12}
        y={34}
        width={node.width - 24}
        height={node.height - 34 - (statusText ? 26 : 12)}
        fill={node.prompt ? '#c8c8d8' : '#8888a0'}
        fontSize={12}
        lineHeight={1.45}
        ellipsis
      />
      {statusText && (
        <Text
          text={statusText.slice(0, 60)}
          x={12}
          y={node.height - 22}
          width={node.width - 24}
          fill={statusColor}
          fontSize={11}
          ellipsis
          wrap="none"
        />
      )}
    </Group>
  )
}
