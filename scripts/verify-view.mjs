// 验证「取产物 → 转 dataURL」这一步（生成已在 test-comfyui.mjs 里跑过，这里只补最后一段）
import { writeFileSync } from 'node:fs'
import { blobToDataURL } from '../src/api/comfyui.ts'

const file = process.argv[2] || 'librecanvas_00001_.mp4'
const qs = new URLSearchParams({ filename: file, subfolder: '', type: 'output' })
const res = await fetch(`http://127.0.0.1:8188/view?${qs}`)
console.log('[verify] /view ->', res.status, res.headers.get('content-type'), res.headers.get('content-length'))
const src = await blobToDataURL(await res.blob())
console.log('[verify] dataURL 前缀:', src.slice(0, 30), ' 长度:', src.length)
if (!src.startsWith('data:video/')) {
  console.error('[verify] FAIL: 不是视频 dataURL')
  process.exit(1)
}
const buf = Buffer.from(src.split(',')[1], 'base64')
writeFileSync('D:/libre-canvas/test-out.mp4', buf)
console.log('[verify] OK', (buf.length / 1e6).toFixed(2), 'MB → D:/libre-canvas/test-out.mp4')
