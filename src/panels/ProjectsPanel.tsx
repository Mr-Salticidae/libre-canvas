import { useProjects } from '../projects'
import { useUI } from '../ui'

function relTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

export function ProjectsPanel() {
  const open = useUI((s) => s.projectsOpen)
  const setOpen = useUI((s) => s.setProjectsOpen)
  const projects = useProjects((s) => s.projects)
  const currentId = useProjects((s) => s.currentId)
  const create = useProjects((s) => s.create)
  const rename = useProjects((s) => s.rename)
  const remove = useProjects((s) => s.remove)
  const switchTo = useProjects((s) => s.switchTo)

  if (!open) return null

  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="projects-panel">
      <h3>画布</h3>
      <ul>
        {sorted.map((p) => (
          <li key={p.id} className={p.id === currentId ? 'current' : ''}>
            <button
              className="p-name"
              title={p.id === currentId ? '当前画布' : '切换到这块画布'}
              onClick={() => {
                void switchTo(p.id)
              }}
            >
              {p.name}
            </button>
            <span className="p-time">{relTime(p.updatedAt)}</span>
            <button
              className="p-act"
              title="重命名"
              onClick={() => {
                const name = prompt('画布名称', p.name)
                if (name != null) rename(p.id, name)
              }}
            >
              ✎
            </button>
            <button
              className="p-act"
              title="删除"
              disabled={projects.length <= 1}
              onClick={() => {
                if (confirm(`删除画布「${p.name}」？此操作不可恢复。`)) void remove(p.id)
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button
        className="primary"
        onClick={() => {
          void create()
        }}
      >
        + 新建画布
      </button>
      <p className="hint">每块画布独立保存在本机浏览器里，切换时自动保存。</p>
      <button className="modal-close" onClick={() => setOpen(false)}>
        ✕
      </button>
    </div>
  )
}
