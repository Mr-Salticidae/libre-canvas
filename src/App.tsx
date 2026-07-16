import { useEffect } from 'react'
import { CanvasStage } from './canvas/CanvasStage'
import { Toolbar } from './panels/Toolbar'
import { Inspector } from './panels/Inspector'
import { SettingsModal } from './panels/SettingsModal'
import { loadDocFromStorage, setupAutosave, useStore } from './store'

let booted = false

export default function App() {
  useEffect(() => {
    if (booted) return
    booted = true
    const doc = loadDocFromStorage()
    if (doc) useStore.setState({ nodes: doc.nodes ?? {}, edges: doc.edges ?? [] })
    setupAutosave()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) {
        return
      }
      const s = useStore.getState()
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length > 0) {
        e.preventDefault()
        s.removeNodes(s.selection)
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        s.undo()
      } else if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault()
        s.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <CanvasStage />
      <Toolbar />
      <Inspector />
      <SettingsModal />
    </>
  )
}
