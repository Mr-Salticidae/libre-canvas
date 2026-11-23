import { useRef } from 'react'
import { useStore } from '../store'
import { fitView, useUI, viewportCenter } from '../ui'
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
    <div className="rail">
      <span className="rail-brand" title="自由画布 LibreCanvas">
        LC
      </span>

      <div className="rail-group">
        <button onClick={addGenerator} title="新建生成节点（也可双击画布）">
          <span className="ico">✦</span>
          <span className="lbl">生成</span>
        </button>
        <button onClick={addText} title="新建文本卡片">
          <span className="ico">T</span>
          <span className="lbl">文本</span>
        </button>
        <button
          onClick={() => imageInput.current?.click()}
          title="上传图片/视频/音频/文本（也可直接拖入画布）"
        >
          <span className="ico">⤒</span>
          <span className="lbl">上传</span>
        </button>
        <button
          onClick={() => useUI.getState().setProjectsOpen(!useUI.getState().projectsOpen)}
          title="画布项目：新建/切换/管理"
        >
          <span className="ico">▤</span>
          <span className="lbl">画布</span>
        </button>
      </div>

      <div className="rail-group">
        <button onClick={undo} title="撤销 (Ctrl+Z)">
          <span className="ico">⤺</span>
        </button>
        <button onClick={redo} title="重做 (Ctrl+Shift+Z)">
          <span className="ico">⤻</span>
        </button>
        <button onClick={fitView} title="适应画布 (F)">
          <span className="ico">⌖</span>
        </button>
      </div>

      <div className="rail-group rail-bottom">
        <button onClick={exportJSON} title="导出画布 JSON">
          <span className="ico">⇩</span>
        </button>
        <button onClick={() => jsonInput.current?.click()} title="导入画布 JSON">
          <span className="ico">⇧</span>
        </button>
        <button onClick={() => setSettingsOpen(true)} title="模型与 API Key 设置">
          <span className="ico">⚙</span>
        </button>
        <button onClick={toggleTheme} title="昼夜切换">
          <span className="ico">{theme === 'dark' ? '☀' : '☾'}</span>
        </button>
        <span className="zoom">{Math.round(camera.scale * 100)}%</span>
      </div>

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
