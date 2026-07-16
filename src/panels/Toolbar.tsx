import { useRef } from 'react'
import { useStore } from '../store'
import { useUI, viewportCenter } from '../ui'
import { uid, type Doc } from '../types'
import { download } from '../helpers'
import { importFilesToCanvas } from '../importFiles'
import { useTheme } from '../theme'
import { useProjects } from '../projects'
import { createGeneratorNode } from '../canvas/CanvasStage'

export function Toolbar() {
  const addNode = useStore((s) => s.addNode)
  const setSelection = useStore((s) => s.setSelection)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const loadDoc = useStore((s) => s.loadDoc)
  const camera = useUI((s) => s.camera)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const imageInput = useRef<HTMLInputElement>(null)
  const jsonInput = useRef<HTMLInputElement>(null)

  const addText = () => {
    const c = viewportCenter(camera)
    const node = {
      id: uid(),
      type: 'text' as const,
      x: c.x - 160,
      y: c.y - 40,
      width: 320,
      height: 80,
      text: '',
    }
    addNode(node)
    setSelection([node.id])
    useUI.getState().setEditingId(node.id)
  }

  const addGenerator = () => {
    const c = viewportCenter(camera)
    const node = createGeneratorNode(c.x - 130, c.y - 75)
    addNode(node)
    setSelection([node.id])
    useUI.getState().requestPromptFocus()
  }

  const importMedia = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const c = viewportCenter(camera)
    await importFilesToCanvas(Array.from(files), { x: c.x - 200, y: c.y - 120 })
  }

  const exportJSON = () => {
    const { nodes, edges } = useStore.getState()
    const ps = useProjects.getState()
    const name = ps.projects.find((p) => p.id === ps.currentId)?.name ?? 'librecanvas'
    download(`${name}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ nodes, edges }, null, 2))
  }

  const importJSON = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      const doc = JSON.parse(await file.text()) as Doc
      loadDoc(doc)
    } catch {
      alert('导入失败：不是有效的画布 JSON 文件')
    }
  }

  const theme = useTheme((s) => s.theme)
  const toggleTheme = useTheme((s) => s.toggle)

  return (
    <div className="toolbar">
      <span className="brand">
        自由画布
        <small>Libre Canvas</small>
      </span>
      <button
        onClick={() => useUI.getState().setProjectsOpen(!useUI.getState().projectsOpen)}
        title="画布项目：新建/切换/管理"
      >
        ▤ 画布
      </button>
      <span className="divider" />
      <button onClick={addGenerator} title="添加 AI 生成节点（也可双击画布）">✦ 生成</button>
      <button onClick={addText} title="添加文本卡片">T 文本</button>
      <button onClick={() => imageInput.current?.click()} title="上传图片/视频/音频/文本文件（也可直接拖入画布）">⤒ 上传</button>
      <span className="divider" />
      <button onClick={undo} title="撤销 (Ctrl+Z)">⤺</button>
      <button onClick={redo} title="重做 (Ctrl+Shift+Z)">⤻</button>
      <span className="divider" />
      <button onClick={exportJSON} title="导出画布为 JSON">导出</button>
      <button onClick={() => jsonInput.current?.click()} title="导入画布 JSON">导入</button>
      <button onClick={() => setSettingsOpen(true)} title="模型与 API Key 设置">⚙ 设置</button>
      <button onClick={toggleTheme} title="昼夜切换">{theme === 'dark' ? '☀' : '☾'}</button>
      <span className="zoom">{Math.round(camera.scale * 100)}%</span>

      <input
        ref={imageInput}
        type="file"
        accept="image/*,video/*,audio/*,.txt,.md,.markdown"
        multiple
        hidden
        onChange={(e) => {
          void importMedia(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={jsonInput}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          void importJSON(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
