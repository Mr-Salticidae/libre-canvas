import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Group, Image as KImage, Rect, Text } from 'react-konva'
import Konva from 'konva'
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
  const [hovered, setHovered] = useState(false)
  const setConnecting = useUI((s) => s.setConnecting)

  return (
    <Group
      x={node.x}
      y={node.y}
      draggable
      {...h}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
      {(hovered || selected) && (
        <Circle
          x={node.width}
          y={node.height / 2}
          radius={8}
          fill={ACCENT}
          stroke="#fff"
          strokeWidth={1.5}
          onMouseDown={(e) => {
            // 拦截住，别触发卡片拖拽/画布平移；由 CanvasStage 接管连线
            e.cancelBubble = true
            setConnecting({
              fromId: node.id,
              x: node.x + node.width,
              y: node.y + node.height / 2,
            })
          }}
        />
      )}
    </Group>
  )
}

/** 播放/暂停小圆钮（视频、音频节点共用） */
function PlayButton({ x, y, playing, onToggle }: { x: number; y: number; playing: boolean; onToggle: () => void }) {
  return (
    <Group
      x={x}
      y={y}
      onClick={(e) => {
        e.cancelBubble = true
        onToggle()
      }}
      onDblClick={(e) => {
        e.cancelBubble = true
      }}
    >
      <Circle radius={16} fill="rgba(20,20,28,0.75)" stroke={ACCENT} strokeWidth={1.5} />
      <Text
        text={playing ? '❚❚' : '▶'}
        x={-16}
        y={-16}
        width={32}
        height={32}
        align="center"
        verticalAlign="middle"
        fill="#fff"
        fontSize={playing ? 10 : 13}
      />
    </Group>
  )
}

export function VideoNode({ node, selected }: NodeProps) {
  const h = useNodeHandlers(node)
  const updateNode = useStore((s) => s.updateNode)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const groupRef = useRef<Konva.Group>(null)

  const video = useMemo(() => {
    if (!node.src) return undefined
    const v = document.createElement('video')
    v.src = node.src
    v.loop = true
    v.playsInline = true
    v.preload = 'auto'
    return v
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.src])

  // 首帧就绪后重绘一次；顺带按真实宽高比修正节点尺寸
  useEffect(() => {
    if (!video) return
    const onReady = () => {
      setReady(true)
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (vw && vh) {
        const expected = Math.round((node.width * vh) / vw)
        if (Math.abs(expected - node.height) > 3) updateNode(node.id, { height: expected })
      }
      groupRef.current?.getLayer()?.batchDraw()
    }
    // 小文件可能在 effect 挂载前就已加载完成，错过 loadeddata 事件
    if (video.readyState >= 2) onReady()
    else video.addEventListener('loadeddata', onReady)
    const onEnd = () => setPlaying(false)
    video.addEventListener('pause', onEnd)
    return () => {
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('pause', onEnd)
      video.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video])

  // 播放期间用 Konva.Animation 驱动 layer 逐帧重绘
  useEffect(() => {
    if (!playing) return
    const layer = groupRef.current?.getLayer()
    if (!layer) return
    const anim = new Konva.Animation(() => {}, layer)
    anim.start()
    return () => {
      anim.stop()
    }
  }, [playing])

  const toggle = () => {
    if (!video) return
    if (video.paused) {
      void video.play()
      setPlaying(true)
    } else {
      video.pause()
      setPlaying(false)
    }
  }

  return (
    <Group ref={groupRef} x={node.x} y={node.y} draggable {...h}>
      <Rect
        width={node.width}
        height={node.height}
        fill="#000"
        cornerRadius={8}
        stroke={selected ? ACCENT : CARD_BORDER}
        strokeWidth={selected ? 2.5 : 1}
        shadowColor="#000"
        shadowBlur={12}
        shadowOpacity={0.4}
      />
      {video && ready ? (
        <KImage image={video} width={node.width} height={node.height} cornerRadius={8} />
      ) : (
        <Text
          text="加载视频…"
          width={node.width}
          height={node.height}
          align="center"
          verticalAlign="middle"
          fill="#8888a0"
          fontSize={13}
        />
      )}
      <PlayButton x={26} y={node.height - 26} playing={playing} onToggle={toggle} />
    </Group>
  )
}

export function AudioNode({ node, selected }: NodeProps) {
  const h = useNodeHandlers(node)
  const [playing, setPlaying] = useState(false)

  const audio = useMemo(() => {
    if (!node.src) return undefined
    return new Audio(node.src)
  }, [node.src])

  useEffect(() => {
    if (!audio) return
    const onStop = () => setPlaying(false)
    audio.addEventListener('ended', onStop)
    audio.addEventListener('pause', onStop)
    return () => {
      audio.removeEventListener('ended', onStop)
      audio.removeEventListener('pause', onStop)
      audio.pause()
    }
  }, [audio])

  const toggle = () => {
    if (!audio) return
    if (audio.paused) {
      void audio.play()
      setPlaying(true)
    } else {
      audio.pause()
      setPlaying(false)
    }
  }

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
      <Text text="🔊 音频" x={12} y={12} fill={ACCENT} fontSize={13} fontStyle="bold" />
      <Text
        text={node.name || node.text || '未命名音频'}
        x={12}
        y={36}
        width={node.width - 70}
        fill="#c8c8d8"
        fontSize={12}
        ellipsis
        wrap="none"
      />
      <PlayButton x={node.width - 32} y={node.height / 2} playing={playing} onToggle={toggle} />
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

export const MODE_LABEL: Record<string, string> = {
  image: '图像',
  text: '文本',
  video: '视频',
  audio: '音频',
}

export function GenNode({ node, selected }: NodeProps) {
  const h = useNodeHandlers(node)
  const statusText =
    node.status === 'running'
      ? `⏳ ${node.progress ?? '生成中…'}`
      : node.status === 'error'
        ? `✕ ${node.error ?? '出错了'}`
        : ''
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
        text={`✦ AI 生成 · ${MODE_LABEL[node.mode ?? 'image'] ?? '图像'}`}
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
