import { useUI } from '../ui'

/** 左下角的后台任务面板：目前只用于本地后处理（超分 + 补帧） */
export function JobsPanel() {
  const jobs = useUI((s) => s.jobs)
  const list = Object.values(jobs)
  if (list.length === 0) return null

  return (
    <div className="jobs-panel">
      {list.map((j) => (
        <div key={j.id} className={'job ' + j.state}>
          <div className="job-head">
            <span className="job-label" title={j.label}>
              {j.state === 'running' ? '⏳' : j.state === 'done' ? '✓' : '✕'} {j.label}
            </span>
            <span className="job-pct">{j.state === 'running' ? `${Math.round(j.progress)}%` : ''}</span>
          </div>
          <div className="job-bar">
            <i style={{ width: `${Math.max(2, Math.min(100, j.progress))}%` }} />
          </div>
          {j.note && <div className="job-note">{j.note}</div>}
        </div>
      ))}
    </div>
  )
}
