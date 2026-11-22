// 验证画布里的 Flux2 文生图链路（走 src/api/comfyui.ts，不经过 React）
import { writeFileSync } from 'node:fs'
import { generateComfyImage } from '../src/api/comfyui.ts'

const provider = {
  id: 'local',
  name: '本地 ComfyUI（H3）',
  kind: 'comfyui',
  baseURL: 'http://127.0.0.1:8188',
  apiKey: '',
  models: [],
}
const preset = process.argv[2] || 'flux2-1024'
const prompt =
  process.argv[3] ||
  'cinematic still of a woman in a rain-soaked neon alley, shallow depth of field, 35mm film, moody teal and amber light'

const t0 = Date.now()
const src = await generateComfyImage(provider, preset, prompt, (m) => console.log('  ..', m))
console.log('[verify] 用时', ((Date.now() - t0) / 1000).toFixed(0), 's，dataURL 长度', src.length)
const buf = Buffer.from(src.split(',')[1], 'base64')
writeFileSync('D:/libre-canvas/test-flux2.png', buf)
console.log('[verify] OK', (buf.length / 1e6).toFixed(2), 'MB → D:/libre-canvas/test-flux2.png')
