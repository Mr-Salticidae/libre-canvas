// 本地后处理桥：画布里的「出 1080p 母版」/「质检」通过它调用产线脚本
//
//   POST /post?target=1920x1080&fps=60&blur=1   请求体是视频二进制
//     → { id }
//   GET  /status?id=xxx                          → { state, progress, note }
//   GET  /result?id=xxx                          → 处理好的 mp4
//   POST /qc?expect=1920x1080&fps=60&audio=yes  请求体是视频二进制
//     → { ok, fails[], warns[], facts{} }        （同步返回，几秒）
//
// 起法：node scripts/post-bridge.mjs
// 可配环境变量：PORT / PYTHON / POST_SCRIPT / QC_SCRIPT

import { createServer } from 'node:http'
import { mkdtempSync, createWriteStream, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.PORT || 8791)
const PYTHON = process.env.PYTHON || 'C:/Users/Administrator/AppData/Local/Python/bin/python.exe'
const POST_SCRIPT =
  process.env.POST_SCRIPT || 'D:/AIGC工作站/99_工具/minimax_h3_tool/scripts/post_1080p60.py'
const QC_SCRIPT =
  process.env.QC_SCRIPT || 'D:/AIGC工作站/99_工具/minimax_h3_tool/scripts/quality_check.py'

/** 本地 ComfyUI：给画布一个「启动服务器」的开关，省得回命令行 */
const COMFY_DIR = process.env.COMFY_DIR || 'C:/ComfyUI-H3/ComfyUI_windows_portable'
const COMFY_PY = process.env.COMFY_PY || join(COMFY_DIR, 'python_embeded', 'python.exe')
const COMFY_ARGS = (
  process.env.COMFY_ARGS ||
  '-s ComfyUI/main.py --windows-standalone-build --lowvram --async-offload --reserve-vram 0.6'
).split(/\s+/)
const COMFY_URL = process.env.COMFY_URL || 'http://127.0.0.1:8188'

/** id → { state, progress, note, dir, out, error } */
const jobs = new Map()

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res, code, body) {
  cors(res)
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/** 把脚本的阶段日志映射成百分比（超分最久，给它最大的区间） */
function progressOf(line) {
  if (line.includes('[1/4]')) return 5
  if (line.includes('[2/4]')) return 15
  if (line.includes('[2.5]')) return 55
  if (line.includes('[3/4]')) return 65
  if (line.includes('[3.5]')) return 75
  if (line.includes('[4/4]')) return 90
  if (line.includes('[OK]')) return 100
  return null
}

function startJob(tmpDir, args, target) {
  const id = Math.random().toString(36).slice(2, 10)
  const out = join(tmpDir, 'out.mp4')
  const job = { id, state: 'running', progress: 3, note: '开始处理…', dir: tmpDir, out, target, t0: Date.now() }
  jobs.set(id, job)

  let stage = 'init'
  const child = spawn(PYTHON, [POST_SCRIPT, join(tmpDir, 'in.mp4'), '-o', out, ...args], {
    windowsHide: true,
    // 不加这两行，Python 会按 Windows 本地编码（cp936）输出中文，读进来就是乱码
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  })
  const onData = (buf) => {
    for (const raw of String(buf).split(/[\r\n]+/)) {
      const line = raw.trim()
      if (!line) continue
      // 记住当前阶段：超分最慢，用 ncnn 自己打的百分比把 15%→55% 这段填满
      if (line.includes('[2/4]')) stage = 'upscale'
      else if (line.includes('[2.5]')) stage = 'scale'
      else if (line.includes('[3/4]')) stage = 'rife'
      else if (line.includes('[3.5]')) stage = 'upscale2'
      else if (line.includes('[4/4]')) stage = 'encode'

      // ncnn 的百分比是按图片循环重置的，不能当总进度用；这里只认阶段，时间在 /status 里补
      if (/^\d+(\.\d+)?%$/.test(line)) continue

      const p = progressOf(line)
      if (p != null) {
        job.progress = Math.max(job.progress, p)
        job.note = line.replace(/^\[\d(\.\d)?\/4\]\s*/, '').slice(0, 60)
      }
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('exit', (code) => {
    if (code === 0) {
      job.state = 'done'
      job.progress = 100
      job.note = '完成'
    } else {
      job.state = 'error'
      job.error = `后处理脚本退出码 ${code}`
    }
  })
  return id
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  if (req.method === 'OPTIONS') {
    cors(res)
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method === 'POST' && url.pathname === '/post') {
    const target = url.searchParams.get('target') || '1920x1080'
    const fps = url.searchParams.get('fps') || '60'
    const blur = url.searchParams.get('blur') === '1'
    const dir = mkdtempSync(join(tmpdir(), 'libre-post-'))
    const file = createWriteStream(join(dir, 'in.mp4'))
    req.pipe(file)
    file.on('finish', () => {
      const args = ['--target', target, '--fps', fps]
      if (blur) args.push('--motion-blur')
      try {
        const id = startJob(dir, args, target)
        json(res, 200, { id })
      } catch (e) {
        json(res, 500, { error: String(e) })
      }
    })
    file.on('error', (e) => json(res, 500, { error: String(e) }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    const job = jobs.get(url.searchParams.get('id') || '')
    if (!job) return json(res, 404, { error: '没有这个任务' })
    const mins = job.t0 ? Math.floor((Date.now() - job.t0) / 60000) : 0
    const note = job.state === 'running' && job.note ? `${job.note} · 已 ${mins} 分` : job.note
    return json(res, 200, { state: job.state, progress: job.progress, note, error: job.error })
  }

  if (req.method === 'GET' && url.pathname === '/result') {
    const job = jobs.get(url.searchParams.get('id') || '')
    if (!job) return json(res, 404, { error: '没有这个任务' })
    if (job.state !== 'done') return json(res, 409, { error: '任务还没完成' })
    try {
      const buf = readFileSync(job.out)
      cors(res)
      res.statusCode = 200
      res.setHeader('content-type', 'video/mp4')
      res.setHeader('content-length', String(buf.length))
      res.end(buf)
      // 结果只取一次，取完清理临时目录
      jobs.delete(job.id)
      setTimeout(() => rmSync(job.dir, { recursive: true, force: true }), 1000)
    } catch (e) {
      json(res, 500, { error: '读取结果失败：' + String(e) })
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/qc') {
    // 不传 expect/fps 就只做结构检查（黑屏/冻帧/静音/兼容），不判分辨率与帧率——
    // 手动质检多半是查原片，拿 1080p60 的规格去卡它只会造成误报
    const expect = url.searchParams.get('expect') || ''
    const fps = url.searchParams.get('fps') || ''
    const audio = url.searchParams.get('audio') || 'any'
    const dir = mkdtempSync(join(tmpdir(), 'libre-qc-'))
    const file = join(dir, 'in.mp4')
    const ws = createWriteStream(file)
    req.pipe(ws)
    ws.on('error', (e) => json(res, 500, { error: String(e) }))
    ws.on('finish', () => {
      const args = [QC_SCRIPT, file, '--json', '--audio', audio]
      if (expect) args.push('--expect', expect)
      if (fps) args.push('--fps', fps)
      const child = spawn(PYTHON, args, {
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      })
      let out = ''
      let err = ''
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (err += d))
      child.on('exit', () => {
        try {
          const qc = JSON.parse(out.trim().split(/\r?\n/).pop())
          json(res, 200, qc)
        } catch {
          json(res, 200, {
            ok: false,
            fails: ['质检脚本输出无法解析：' + (err || out).slice(-300)],
            warns: [],
            facts: {},
          })
        }
        rmSync(dir, { recursive: true, force: true })
      })
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/comfy/status') {
    try {
      const r = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(4000) })
      if (!r.ok) return json(res, 200, { up: false, detail: `HTTP ${r.status}` })
      const s = await r.json()
      return json(res, 200, {
        up: true,
        version: s?.system?.comfyui_version,
        vramTotal: s?.system?.vram_total,
      })
    } catch (e) {
      return json(res, 200, { up: false, detail: String(e).slice(0, 120) })
    }
  }

  if (req.method === 'POST' && url.pathname === '/comfy/start') {
    void (async () => {
      // 已经在跑就直接回，避免重复起进程抢 8188
      try {
        const probe = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(3000) })
        if (probe.ok) return json(res, 200, { state: 'already' })
      } catch {
        // 没起，继续
      }
      try {
        const { spawn: spawnDetached } = await import('node:child_process')
        const child = spawnDetached(COMFY_PY, COMFY_ARGS, {
          cwd: COMFY_DIR,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
        child.unref()
        console.log(`[post-bridge] 启动 ComfyUI pid=${child.pid}`)
      } catch (e) {
        return json(res, 500, { state: 'error', error: String(e) })
      }
      // 等服务真的起来（模型不加载，通常 30~60 秒）
      const t0 = Date.now()
      while (Date.now() - t0 < 180_000) {
        await new Promise((r) => setTimeout(r, 3000))
        try {
          const probe = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(3000) })
          if (probe.ok) {
            const s = await probe.json()
            return json(res, 200, {
              state: 'started',
              seconds: Math.round((Date.now() - t0) / 1000),
              version: s?.system?.comfyui_version,
            })
          }
        } catch {
          // 还没起来
        }
      }
      json(res, 200, { state: 'timeout', error: '180 秒内没起来，去看 ComfyUI 窗口的报错' })
    })()
    return
  }

  json(res, 404, { error: '未知路由' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[post-bridge] listening on http://127.0.0.1:${PORT}`)
  console.log(`[post-bridge] python: ${PYTHON}`)
  console.log(`[post-bridge] script: ${POST_SCRIPT}`)
})
