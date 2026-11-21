// 端到端验证 ComfyUI 适配层（不经过 React）：上传首帧 → 提交 H3 图 → 轮询 → 下载成片
// 用 Node 24 的类型擦除直接跑 .ts：node --experimental-strip-types scripts/test-comfyui.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { generateComfyVideo, H3_PRESETS } from '../src/api/comfyui.ts'

const IMG = 'C:/ComfyUI-H3/ComfyUI_windows_portable/ComfyUI/input/h3_frame_ref_1.png'
const preset = process.argv[2] || 'h3-16x9-draft'
const provider = {
  id: 'test',
  name: '本地 ComfyUI',
  kind: 'comfyui',
  baseURL: 'http://127.0.0.1:8188',
  apiKey: '',
  models: H3_PRESETS.map((p) => p.id),
}

const dataURL = 'data:image/png;base64,' + readFileSync(IMG).toString('base64')
console.log('[test] preset =', preset, ' image =', IMG)

const t0 = Date.now()
const src = await generateComfyVideo(
  provider,
  preset,
  'The woman slowly lowers the green apple to reveal her eye, subtle head turn, cinematic studio light.',
  { images: [dataURL] },
  (m) => console.log('  ..', m),
)
const head = src.slice(0, 40)
console.log('[test] 耗时', ((Date.now() - t0) / 1000).toFixed(0), 's  前缀:', head)
if (!src.startsWith('data:video/')) {
  console.error('[test] FAIL: 返回值不是视频 dataURL')
  process.exit(1)
}
const b64 = src.split(',')[1]
const buf = Buffer.from(b64, 'base64')
writeFileSync('D:/libre-canvas/test-out.mp4', buf)
console.log('[test] OK  ' + (buf.length / 1e6).toFixed(1) + 'MB → D:/libre-canvas/test-out.mp4')
