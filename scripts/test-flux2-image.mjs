// 本地 Flux2 Klein 4B（GGUF）文生图冒烟：验证 ComfyUI 侧节点链路通不通
// node --experimental-strip-types scripts/test-flux2-image.mjs ["prompt"] [steps] [size]

const COMFY = 'http://127.0.0.1:8188'
const prompt = process.argv[2] || 'cinematic portrait of a woman in a sunlit garden, soft rim light, 85mm lens, film grain'
const steps = Number(process.argv[3] || 8)
const size = Number(process.argv[4] || 1024)

const graph = {
  1: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'flux-2-klein-4b-Q4_0.gguf' } },
  2: {
    class_type: 'CLIPLoaderGGUF',
    inputs: { clip_name: 'Qwen3-4B-Q4_K_M.gguf', type: 'flux2' },
  },
  3: { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
  5: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  6: { class_type: 'EmptyFlux2LatentImage', inputs: { width: size, height: size, batch_size: 1 } },
  7: { class_type: 'Flux2Scheduler', inputs: { steps, width: size, height: size } },
  8: { class_type: 'BasicGuider', inputs: { model: ['1', 0], conditioning: ['4', 0] } },
  9: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
  10: { class_type: 'RandomNoise', inputs: { noise_seed: Math.floor(Math.random() * 1e9) } },
  11: {
    class_type: 'SamplerCustomAdvanced',
    inputs: {
      noise: ['10', 0],
      guider: ['8', 0],
      sampler: ['9', 0],
      sigmas: ['7', 0],
      latent_image: ['6', 0],
    },
  },
  12: { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
  13: { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: 'libre-flux2' } },
}

const t0 = Date.now()
const sub = await fetch(`${COMFY}/prompt`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: graph, client_id: 'flux2-test' }),
})
const sj = await sub.json()
if (!sj.prompt_id) {
  console.error('[test] 提交失败:', JSON.stringify(sj).slice(0, 800))
  process.exit(1)
}
console.log('[test] submitted', sj.prompt_id, `steps=${steps} size=${size}`)

for (;;) {
  await new Promise((r) => setTimeout(r, 2000))
  const h = await (await fetch(`${COMFY}/history/${sj.prompt_id}`)).json()
  const e = h[sj.prompt_id]
  if (e) {
    const st = e.status?.status_str
    if (st === 'error') {
      console.error('[test] 执行失败:', JSON.stringify(e.status?.messages ?? {}).slice(0, 900))
      process.exit(1)
    }
    if (st === 'success' || e.status?.completed) {
      const out = Object.values(e.outputs ?? {})[0] ?? {}
      const imgs = out.images ?? []
      console.log('[test] done in', ((Date.now() - t0) / 1000).toFixed(0), 's ->', imgs.map((i) => i.filename).join(','))
      process.exit(0)
    }
  }
  if (Date.now() - t0 > 15 * 60_000) {
    console.error('[test] 超时')
    process.exit(1)
  }
}
