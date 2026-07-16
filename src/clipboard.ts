/** 画布内部剪贴板：跨画布项目有效（内存级，不进系统剪贴板） */
import { useStore } from './store'
import { uid, type CanvasNode, type Edge } from './types'

let clipboard: { nodes: CanvasNode[]; edges: Edge[] } | null = null

export function copySelection(): number {
  const s = useStore.getState()
  if (s.selection.length === 0) return 0
  const ids = new Set(s.selection)
  const nodes = s.selection.map((id) => s.nodes[id]).filter(Boolean).map((n) => ({ ...n }))
  const edges = s.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ ...e }))
  clipboard = { nodes, edges }
  return nodes.length
}

export function hasClipboard(): boolean {
  return !!clipboard && clipboard.nodes.length > 0
}

function cloneInto(nodes: CanvasNode[], edges: Edge[], dx: number, dy: number) {
  const s = useStore.getState()
  s.snapshot()
  const idMap = new Map<string, string>()
  const gidMap = new Map<string, string>()
  const newIds: string[] = []
  for (const n of nodes) {
    const id = uid()
    idMap.set(n.id, id)
    let groupId: string | undefined
    if (n.groupId) {
      if (!gidMap.has(n.groupId)) gidMap.set(n.groupId, uid() + '-g')
      groupId = gidMap.get(n.groupId)
    }
    s.addNode(
      { ...n, id, x: n.x + dx, y: n.y + dy, groupId, status: 'idle', error: undefined, progress: undefined },
      { history: false },
    )
    newIds.push(id)
  }
  for (const e of edges) {
    const from = idMap.get(e.from)
    const to = idMap.get(e.to)
    if (from && to) s.addEdge({ id: uid(), from, to })
  }
  s.setSelection(newIds)
}

/** 粘贴。传 at（世界坐标）则整体居中到该点，否则相对原位偏移 24px */
export function pasteClipboard(at?: { x: number; y: number }) {
  if (!clipboard || clipboard.nodes.length === 0) return
  let dx = 24
  let dy = 24
  if (at) {
    const xs = clipboard.nodes.map((n) => n.x)
    const ys = clipboard.nodes.map((n) => n.y)
    const xe = clipboard.nodes.map((n) => n.x + n.width)
    const ye = clipboard.nodes.map((n) => n.y + n.height)
    const cx = (Math.min(...xs) + Math.max(...xe)) / 2
    const cy = (Math.min(...ys) + Math.max(...ye)) / 2
    dx = at.x - cx
    dy = at.y - cy
  }
  cloneInto(clipboard.nodes, clipboard.edges, dx, dy)
}

/** 创建副本（不占用剪贴板） */
export function duplicateSelection() {
  const s = useStore.getState()
  if (s.selection.length === 0) return
  const ids = new Set(s.selection)
  const nodes = s.selection.map((id) => s.nodes[id]).filter(Boolean)
  const edges = s.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
  cloneInto(nodes, edges, 24, 24)
}
