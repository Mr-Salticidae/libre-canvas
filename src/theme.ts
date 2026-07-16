/**
 * 设计 token —— 与主站「蛛网之上」(tiaozhuxiansheng.com) 同源：
 * 暖白纸面 / 夜幕双皮肤，蛛丝紫点睛。画布应用以夜屏为默认。
 * Konva 画布无法用 CSS 变量，节点颜色从这里取。
 */
import { create } from 'zustand'

export type ThemeName = 'light' | 'dark'

export interface Palette {
  paper: string
  paper2: string
  paper3: string
  ink: string
  inkSoft: string
  line: string
  accent: string
  accent2: string
  accentSoft: string
  danger: string
  warn: string
  shadow: string
  shadowOpacity: number
}

export const PALETTES: Record<ThemeName, Palette> = {
  light: {
    paper: '#faf8f3',
    paper2: '#ffffff',
    paper3: '#f1ece2',
    ink: '#1b1813',
    inkSoft: '#6b6357',
    line: '#e7dfd0',
    accent: '#6d4aff',
    accent2: '#c44aff',
    accentSoft: '#efeaff',
    danger: '#c0392b',
    warn: '#9a6b00',
    shadow: '#1e183c',
    shadowOpacity: 0.18,
  },
  dark: {
    paper: '#100f16',
    paper2: '#17151f',
    paper3: '#1d1b27',
    ink: '#ece8f5',
    inkSoft: '#9a93ad',
    line: '#2a2738',
    accent: '#9b85ff',
    accent2: '#d98bff',
    accentSoft: '#221d36',
    danger: '#ff6b6b',
    warn: '#f0a651',
    shadow: '#000000',
    shadowOpacity: 0.4,
  },
}

export const CANVAS_FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif'

const KEY = 'librecanvas.theme'

function apply(theme: ThemeName) {
  document.documentElement.dataset.theme = theme
}

const initial: ThemeName = (localStorage.getItem(KEY) as ThemeName) || 'dark'
apply(initial)

interface ThemeState {
  theme: ThemeName
  toggle: () => void
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initial,
  toggle: () => {
    const next: ThemeName = get().theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(KEY, next)
    apply(next)
    set({ theme: next })
  },
}))

export function usePalette(): Palette {
  return PALETTES[useTheme((s) => s.theme)]
}
