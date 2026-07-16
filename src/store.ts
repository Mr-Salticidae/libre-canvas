import { create } from 'zustand'
import type { CanvasNode, Doc, Edge } from './types'
import { idbGet } from './storage'

const DOC_KEY = 'librecanvas.doc.v1'

interface StoreState extends Doc {
  selection: string[]
  past: Doc[]
  future: Doc[]

  snapshot: () => void
  addNode: (node: CanvasNode, opts?: { history?: boolean }) => void
  updateNode: (id: string, patch: Partial<CanvasNode>) => void
  removeNodes: (ids: string[]) => void
  addEdge: (edge: Edge) => void
  removeEdge: (id: string) => void
  setSelection: (ids: string[]) => void
  moveNodes: (ids: string[], dx: number, dy: number) => void
  groupSelected: () => void
  ungroupSelected: () => void
  undo: () => void
  redo: () => void
  loadDoc: (doc: Doc) => void
  /** 项目切换：整体替换文档并清空历史（不产生撤销记录） */
  resetDoc: (doc: Doc) => void
}

function cloneDoc(s: Doc): Doc {
  return { nodes: { ...s.nodes }, edges: [...s.edges] }
}

export const useStore = create<StoreState>((set, get) => ({
  nodes: {},
  edges: [],
  selection: [],
  past: [],
  future: [],

  snapshot: () => {
    const s = get()
    set({ past: [...s.past.slice(-49), cloneDoc(s)], future: [] })
  },

  addNode: (node, opts) => {
    if (opts?.history !== false) get().snapshot()
    set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }))
  },

  updateNode: (id, patch) => {
    set((s) => {
      const cur = s.nodes[id]
      if (!cur) return s
      return { nodes: { ...s.nodes, [id]: { ...cur, ...patch } } }
    })
  },

  removeNodes: (ids) => {
    if (ids.length === 0) return
    get().snapshot()
    set((s) => {
      const nodes = { ...s.nodes }
      for (const id of ids) delete nodes[id]
      const edges = s.edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to))
      const selection = s.selection.filter((id) => !ids.includes(id))
      return { nodes, edges, selection }
    })
  },

  addEdge: (edge) => {
    set((s) => ({ edges: [...s.edges, edge] }))
  },

  removeEdge: (id) => {
    get().snapshot()
    set((s) => ({ edges: s.edges.filter((e) => e.id !== id) }))
  },

  setSelection: (ids) => set({ selection: ids }),

  moveNodes: (ids, dx, dy) => {
    if (ids.length === 0 || (dx === 0 && dy === 0)) return
    set((s) => {
      const nodes = { ...s.nodes }
      for (const id of ids) {
        const n = nodes[id]
        if (n) nodes[id] = { ...n, x: n.x + dx, y: n.y + dy }
      }
      return { nodes }
    })
  },

  groupSelected: () => {
    const s = get()
    if (s.selection.length < 2) return
    s.snapshot()
    const groupId = s.selection.slice().sort().join('-').slice(0, 24) + '-g'
    set((st) => {
      const nodes = { ...st.nodes }
      for (const id of st.selection) {
        const n = nodes[id]
        if (n) nodes[id] = { ...n, groupId }
      }
      return { nodes }
    })
  },

  ungroupSelected: () => {
    const s = get()
    if (s.selection.length === 0) return
    s.snapshot()
    set((st) => {
      const nodes = { ...st.nodes }
      for (const id of st.selection) {
        const n = nodes[id]
        if (n?.groupId) nodes[id] = { ...n, groupId: undefined }
      }
      return { nodes }
    })
  },

  undo: () => {
    const s = get()
    const prev = s.past[s.past.length - 1]
    if (!prev) return
    set({
      ...cloneDoc(prev),
      past: s.past.slice(0, -1),
      future: [cloneDoc(s), ...s.future.slice(0, 49)],
      selection: [],
    })
  },

  redo: () => {
    const s = get()
    const next = s.future[0]
    if (!next) return
    set({
      ...cloneDoc(next),
      past: [...s.past.slice(-49), cloneDoc(s)],
      future: s.future.slice(1),
      selection: [],
    })
  },

  loadDoc: (doc) => {
    get().snapshot()
    set({ nodes: doc.nodes ?? {}, edges: doc.edges ?? [], selection: [] })
  },

  resetDoc: (doc) => {
    set({ nodes: doc.nodes ?? {}, edges: doc.edges ?? [], selection: [], past: [], future: [] })
  },
}))

/** 读取多画布之前的单画布旧数据（供 projects 首次迁移用） */
export async function loadLegacyDoc(): Promise<Doc | null> {
  try {
    const doc = await idbGet<Doc>('doc')
    if (doc) return doc
    const raw = localStorage.getItem(DOC_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Doc
  } catch {
    return null
  }
}
