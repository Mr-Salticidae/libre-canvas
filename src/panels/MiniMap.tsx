import { useRef } from 'react'
import { useStore } from '../store'
import { useUI } from '../ui'

const W = 200
const H = 136
const PAD = 10

interface Mapping {
  minX: number
  minY: number
  scale: number
}

/** 右下角小地图：内容缩影 + 视口框，点击/拖拽跳转 */
export function MiniMap() {
  const nodes = useStore((s) => s.nodes)
  const camera = useUI((s) => s.camera)
  const setCamera = useUI((s) => s.setCamera)
  const dragMap = useRef<Mapping | null>(null)

  const list = Object.values(nodes)
  if (list.length === 0) return null

  // 视口的世界矩形
  const vp = {
    x: -camera.x / camera.scale,
    y: -camera.y / camera.scale,
    w: window.innerWidth / camera.scale,
    h: window.innerHeight / camera.scale,
  }
  const minX = Math.min(...list.map((n) => n.x), vp.x)
  const minY = Math.min(...list.map((n) => n.y), vp.y)
  const maxX = Math.max(...list.map((n) => n.x + n.width), vp.x + vp.w)
  const maxY = Math.max(...list.map((n) => n.y + n.height), vp.y + vp.h)
  const scale = Math.min((W - PAD * 2) / Math.max(1, maxX - minX), (H - PAD * 2) / Math.max(1, maxY - minY))
  const live: Mapping = { minX, minY, scale }

  const jump = (e: React.PointerEvent, map: Mapping) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const wx = (e.clientX - rect.left - PAD) / map.scale + map.minX
    const wy = (e.clientY - rect.top - PAD) / map.scale + map.minY
    setCamera({
      x: window.innerWidth / 2 - wx * camera.scale,
      y: window.innerHeight / 2 - wy * camera.scale,
      scale: camera.scale,
    })
  }

  return (
    <div
      className="minimap"
      style={{ width: W, height: H }}
      onPointerDown={(e) => {
        // 拖拽期间冻结映射，避免视口移动反馈引起抖动
        dragMap.current = live
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        jump(e, live)
      }}
      onPointerMove={(e) => {
        if (dragMap.current) jump(e, dragMap.current)
      }}
      onPointerUp={() => {
        dragMap.current = null
      }}
    >
      {list.map((n) => (
        <div
          key={n.id}
          className={`mm-node mm-${n.type}`}
          style={{
            left: PAD + (n.x - live.minX) * live.scale,
            top: PAD + (n.y - live.minY) * live.scale,
            width: Math.max(2, n.width * live.scale),
            height: Math.max(2, n.height * live.scale),
          }}
        />
      ))}
      <div
        className="mm-viewport"
        style={{
          left: PAD + (vp.x - live.minX) * live.scale,
          top: PAD + (vp.y - live.minY) * live.scale,
          width: vp.w * live.scale,
          height: vp.h * live.scale,
        }}
      />
    </div>
  )
}
