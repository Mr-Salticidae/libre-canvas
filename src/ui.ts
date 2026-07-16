import { create } from 'zustand'

export interface Camera {
  x: number
  y: number
  scale: number
}

interface UIState {
  camera: Camera
  setCamera: (c: Camera) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  /** 正在内联编辑文本的节点 id */
  editingId: string | null
  setEditingId: (id: string | null) => void
}

export const useUI = create<UIState>((set) => ({
  camera: { x: 0, y: 0, scale: 1 },
  setCamera: (camera) => set({ camera }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  editingId: null,
  setEditingId: (editingId) => set({ editingId }),
}))

/** 屏幕坐标 → 世界坐标 */
export function toWorld(camera: Camera, sx: number, sy: number) {
  return { x: (sx - camera.x) / camera.scale, y: (sy - camera.y) / camera.scale }
}

/** 当前视口中心的世界坐标 */
export function viewportCenter(camera: Camera) {
  return toWorld(camera, window.innerWidth / 2, window.innerHeight / 2)
}
