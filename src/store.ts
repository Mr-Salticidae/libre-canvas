import { create } from 'zustand'
import type { CanvasNode, Doc, Edge } from './types'
import { idbGet, idbSet } from './storage'

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
  setSelection: (ids: string[]) => void
  undo: () => void
  redo: () => void
  loadDoc: (doc: Doc) => void
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

  setSelection: (ids) => set({ selection: ids }),

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
}))

export async function loadDocFromStorage(): Promise<Doc | null> {
  try {
    const doc = await idbGet<Doc>('doc')
    if (doc) return doc
    // 从旧版 localStorage 迁移一次
    const raw = localStorage.getItem(DOC_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Doc
  } catch {
    return null
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export function setupAutosave() {
  useStore.subscribe((s) => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void idbSet('doc', { nodes: s.nodes, edges: s.edges }).catch(() => {
        // 写入失败（隐私模式等）静默跳过，导出 JSON 仍可用
      })
    }, 500)
  })
}
