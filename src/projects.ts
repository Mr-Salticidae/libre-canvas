/** 多画布项目：元信息存 localStorage，各画布文档存 IndexedDB（doc:<id>） */
import { create } from 'zustand'
import { loadLegacyDoc, useStore } from './store'
import { idbDel, idbGet, idbSet } from './storage'
import { uid, type Doc } from './types'

export interface ProjectMeta {
  id: string
  name: string
  updatedAt: number
}

const META_KEY = 'librecanvas.projects.v1'
const CUR_KEY = 'librecanvas.currentProject.v1'

function loadMetas(): ProjectMeta[] {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? '[]') as ProjectMeta[]
  } catch {
    return []
  }
}

function saveMetas(metas: ProjectMeta[]) {
  localStorage.setItem(META_KEY, JSON.stringify(metas))
}

async function saveDoc(id: string) {
  const { nodes, edges } = useStore.getState()
  await idbSet(`doc:${id}`, { nodes, edges }).catch(() => {
    // 写入失败（隐私模式等）静默跳过，导出 JSON 仍可用
  })
}

interface ProjectsState {
  projects: ProjectMeta[]
  currentId: string | null
  touch: (id: string) => void
  create: () => Promise<void>
  rename: (id: string, name: string) => void
  remove: (id: string) => Promise<void>
  switchTo: (id: string) => Promise<void>
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  currentId: null,

  touch: (id) => {
    set((s) => {
      const projects = s.projects.map((p) => (p.id === id ? { ...p, updatedAt: Date.now() } : p))
      saveMetas(projects)
      return { projects }
    })
  },

  create: async () => {
    const s = get()
    if (s.currentId) await saveDoc(s.currentId)
    const id = uid()
    const name = `画布 ${s.projects.length + 1}`
    const projects = [...s.projects, { id, name, updatedAt: Date.now() }]
    saveMetas(projects)
    localStorage.setItem(CUR_KEY, id)
    set({ projects, currentId: id })
    useStore.getState().resetDoc({ nodes: {}, edges: [] })
  },

  rename: (id, name) => {
    set((s) => {
      const projects = s.projects.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p))
      saveMetas(projects)
      return { projects }
    })
  },

  remove: async (id) => {
    const s = get()
    if (s.projects.length <= 1) return
    const projects = s.projects.filter((p) => p.id !== id)
    saveMetas(projects)
    await idbDel(`doc:${id}`)
    if (s.currentId === id) {
      set({ projects })
      await get().switchTo(projects[0].id)
    } else {
      set({ projects })
    }
  },

  switchTo: async (id) => {
    const s = get()
    if (id === s.currentId) return
    if (s.currentId) await saveDoc(s.currentId)
    localStorage.setItem(CUR_KEY, id)
    set({ currentId: id })
    const doc = await idbGet<Doc>(`doc:${id}`)
    useStore.getState().resetDoc(doc ?? { nodes: {}, edges: [] })
  },
}))

/** 启动：载入项目列表与当前画布；首次运行时迁移旧版单画布数据 */
export async function bootProjects() {
  let metas = loadMetas()
  let cur = localStorage.getItem(CUR_KEY)

  if (metas.length === 0) {
    const id = uid()
    const legacy = await loadLegacyDoc()
    metas = [{ id, name: '画布 1', updatedAt: Date.now() }]
    saveMetas(metas)
    if (legacy) await idbSet(`doc:${id}`, legacy)
    cur = id
  }
  if (!cur || !metas.some((m) => m.id === cur)) cur = metas[0].id
  localStorage.setItem(CUR_KEY, cur)

  useProjects.setState({ projects: metas, currentId: cur })
  const doc = await idbGet<Doc>(`doc:${cur}`)
  useStore.getState().resetDoc(doc ?? { nodes: {}, edges: [] })
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** 文档变化 500ms 后落盘到当前画布 */
export function setupProjectAutosave() {
  useStore.subscribe(() => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const id = useProjects.getState().currentId
      if (!id) return
      void saveDoc(id).then(() => useProjects.getState().touch(id))
    }, 500)
  })
}
