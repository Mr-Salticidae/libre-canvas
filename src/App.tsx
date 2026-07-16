import { useEffect } from 'react'
import { CanvasStage } from './canvas/CanvasStage'
import { Toolbar } from './panels/Toolbar'
import { Inspector } from './panels/Inspector'
import { SettingsModal } from './panels/SettingsModal'
import { MaskEditor } from './panels/MaskEditor'
import { ProjectsPanel } from './panels/ProjectsPanel'
import { ContextMenu } from './panels/ContextMenu'
import { useStore } from './store'
import { bootProjects, setupProjectAutosave } from './projects'
import { copySelection, duplicateSelection, pasteClipboard } from './clipboard'
import { fitView, useUI } from './ui'

let booted = false

export default function App() {
  useEffect(() => {
    if (booted) return
    booted = true
    void bootProjects().then(() => {
      setupProjectAutosave()
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) {
        return
      }
      // 弹层打开时不响应画布快捷键（蒙版涂抹时按 Delete 不该删节点）
      const ui = useUI.getState()
      if (ui.maskEditingId || ui.settingsOpen) return
      const s = useStore.getState()
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length > 0) {
        e.preventDefault()
        s.removeNodes(s.selection)
      } else if (e.key === 'Escape') {
        s.setSelection([])
        ui.setProjectsOpen(false)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        s.setSelection(Object.keys(s.nodes))
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        copySelection()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        pasteClipboard()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelection()
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        fitView()
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        s.groupSelected()
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        s.ungroupSelected()
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
      <ProjectsPanel />
      <Inspector />
      <SettingsModal />
      <MaskEditor />
      <ContextMenu />
    </>
  )
}
