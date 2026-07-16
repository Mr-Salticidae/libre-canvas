import { create } from 'zustand'
import type { Provider } from './types'

const KEY = 'librecanvas.providers.v1'

interface ProviderState {
  providers: Provider[]
  upsert: (p: Provider) => void
  remove: (id: string) => void
}

function load(): Provider[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Provider[]) : []
  } catch {
    return []
  }
}

function save(providers: Provider[]) {
  localStorage.setItem(KEY, JSON.stringify(providers))
}

export const useProviders = create<ProviderState>((set) => ({
  providers: load(),
  upsert: (p) =>
    set((s) => {
      const idx = s.providers.findIndex((x) => x.id === p.id)
      const providers =
        idx >= 0
          ? s.providers.map((x) => (x.id === p.id ? p : x))
          : [...s.providers, p]
      save(providers)
      return { providers }
    }),
  remove: (id) =>
    set((s) => {
      const providers = s.providers.filter((x) => x.id !== id)
      save(providers)
      return { providers }
    }),
}))
