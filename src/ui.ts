import { create } from 'zustand'

export interface Camera {
  x: number
  y: number
  scale: number
}

/** 正在从某个节点锚点拖出参考连线 */
export interface Connecting {
  fromId: string
  /** 拖动端当前的世界坐标 */
  x: number
  y: number
}

interface UIState {
  camera: Camera
  setCamera: (c: Camera) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  /** 正在内联编辑文本的节点 id */
  editingId: string | null
  setEditingId: (id: string | null) => void
  connecting: Connecting | null
  setConnecting: (c: Connecting | null) => void
  /** 正在做蒙版重绘的图片节点 id */
  maskEditingId: string | null
  setMaskEditingId: (id: string | null) => void
  projectsOpen: boolean
  setProjectsOpen: (open: boolean) => void
  /** 拖动吸附辅助线（世界坐标，v=竖线 x / h=横线 y） */
  guides: { v?: number; h?: number } | null
  setGuides: (g: { v?: number; h?: number } | null) => void
  /** 双击生成节点 → 请求聚焦提示词框（自增计数触发） */
  promptFocusTick: number
  requestPromptFocus: () => void
}

export const useUI = create<UIState>((set) => ({
  camera: { x: 0, y: 0, scale: 1 },
  setCamera: (camera) => set({ camera }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  editingId: null,
  setEditingId: (editingId) => set({ editingId }),
  connecting: null,
  setConnecting: (connecting) => set({ connecting }),
  maskEditingId: null,
  setMaskEditingId: (maskEditingId) => set({ maskEditingId }),
  projectsOpen: false,
  setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
  guides: null,
  setGuides: (guides) => set({ guides }),
  promptFocusTick: 0,
  requestPromptFocus: () => set((s) => ({ promptFocusTick: s.promptFocusTick + 1 })),
}))

/** 屏幕坐标 → 世界坐标 */
export function toWorld(camera: Camera, sx: number, sy: number) {
  return { x: (sx - camera.x) / camera.scale, y: (sy - camera.y) / camera.scale }
}

/** 当前视口中心的世界坐标 */
export function viewportCenter(camera: Camera) {
  return toWorld(camera, window.innerWidth / 2, window.innerHeight / 2)
}
