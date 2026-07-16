import { useEffect } from 'react'
import { useStore } from '../store'
import { fitView, toWorld, useUI } from '../ui'
import { copySelection, duplicateSelection, hasClipboard, pasteClipboard } from '../clipboard'
import { iterateFromNode } from '../branch'
import { createGeneratorNode } from '../canvas/CanvasStage'
import { uid } from '../types'

export function ContextMenu() {
  const menu = useUI((s) => s.contextMenu)
  const setMenu = useUI((s) => s.setContextMenu)
  const nodes = useStore((s) => s.nodes)
  const selection = useStore((s) => s.selection)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('wheel', close)
    }
  }, [menu, setMenu])

  if (!menu) return null

  const node = menu.nodeId ? nodes[menu.nodeId] : undefined
  const camera = useUI.getState().camera
  const world = toWorld(camera, menu.x, menu.y)
  const S = useStore.getState()
  const anyGrouped = selection.some((id) => nodes[id]?.groupId)

  const item = (label: string, action: () => void, opts?: { disabled?: boolean; kbd?: string }) => (
    <button
      key={label}
      disabled={opts?.disabled}
      onMouseDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        setMenu(null)
        action()
      }}
    >
      <span>{label}</span>
      {opts?.kbd && <kbd>{opts.kbd}</kbd>}
    </button>
  )

  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 200),
    top: Math.min(menu.y, window.innerHeight - 320),
  }

  return (
    <div className="context-menu" style={style} onMouseDown={(e) => e.stopPropagation()}>
      {node ? (
        <>
          {(node.type === 'image' || node.type === 'text') &&
            item('✦ 以此迭代（开新分支）', () => iterateFromNode(node))}
          {item('复制', () => copySelection(), { kbd: 'Ctrl+C' })}
          {item('创建副本', () => duplicateSelection(), { kbd: 'Ctrl+D' })}
          {(node.type === 'image' || node.type === 'video' || node.type === 'audio') &&
            node.src &&
            item('下载', () => {
              const a = document.createElement('a')
              a.href = node.src!
              a.download = node.name || `librecanvas-${node.type}`
              a.click()
            })}
          {node.type === 'image' &&
            node.src &&
            item('局部重绘', () => useUI.getState().setMaskEditingId(node.id))}
          {node.type === 'text' && item('编辑文本', () => useUI.getState().setEditingId(node.id))}
          {selection.length > 1 && item('编组', () => S.groupSelected(), { kbd: 'Ctrl+G' })}
          {anyGrouped && item('解组', () => S.ungroupSelected(), { kbd: 'Ctrl+Shift+G' })}
          <div className="cm-divider" />
          {item('删除', () => S.removeNodes(useStore.getState().selection), { kbd: 'Del' })}
        </>
      ) : (
        <>
          {item('粘贴到此处', () => pasteClipboard(world), { disabled: !hasClipboard(), kbd: 'Ctrl+V' })}
          <div className="cm-divider" />
          {item('新建生成节点', () => {
            const n = createGeneratorNode(world.x - 130, world.y - 75)
            S.addNode(n)
            S.setSelection([n.id])
            useUI.getState().requestPromptFocus()
          })}
          {item('新建文本', () => {
            const n = { id: uid(), type: 'text' as const, x: world.x - 160, y: world.y - 40, width: 320, height: 80, text: '' }
            S.addNode(n)
            S.setSelection([n.id])
            useUI.getState().setEditingId(n.id)
          })}
          <div className="cm-divider" />
          {item('适应画布', () => fitView(), { kbd: 'F' })}
          {item('全选', () => S.setSelection(Object.keys(useStore.getState().nodes)), { kbd: 'Ctrl+A' })}
        </>
      )}
    </div>
  )
}
