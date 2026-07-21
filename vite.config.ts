import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 开发期 CORS 代理。
 *
 * 官方 OpenAI 等接口不返回跨域头（Access-Control-Allow-Origin），纯前端应用用浏览器
 * 直连会被 CORS 拦下——表现为「Failed to fetch」或长时间卡死。这个中间件把本该发往
 * 那些接口的请求，改由 dev server 以「服务器身份」转发：浏览器只跟同源的 /__cors 说话
 * （同源无跨域问题），真实目标地址放在 x-cors-target 请求头里，dev server 拿到后原样转发。
 *
 * 仅在 `npm run dev` 时挂载，打包部署的静态版本不受影响、也不含此逻辑。
 */
function corsProxy(): Plugin {
  return {
    name: 'libre-canvas-cors-proxy',
    configureServer(server) {
      server.middlewares.use('/__cors', (req, res) => {
        void (async () => {
          const target = req.headers['x-cors-target']
          if (typeof target !== 'string' || !/^https?:\/\//i.test(target)) {
            res.statusCode = 400
            res.end('缺少或非法的 x-cors-target 请求头')
            return
          }
          // 中间件挂在 /__cors 上，connect 会把该前缀从 req.url 剥掉，剩下的就是真实路径 + query
          const url = target.replace(/\/+$/, '') + (req.url || '')
          const chunks = []
          for await (const c of req) chunks.push(c)
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0
          // 只转发必要的头：Authorization 带 key，Content-Type 对 multipart 还带着 boundary，不能丢
          const fwd = {}
          if (req.headers['authorization']) fwd['authorization'] = req.headers['authorization']
          if (req.headers['content-type']) fwd['content-type'] = req.headers['content-type']
          try {
            const upstream = await fetch(url, {
              method: req.method,
              headers: fwd,
              body: hasBody ? Buffer.concat(chunks) : undefined,
            })
            res.statusCode = upstream.status
            const ct = upstream.headers.get('content-type')
            if (ct) res.setHeader('content-type', ct)
            res.setHeader('access-control-allow-origin', '*')
            res.end(Buffer.from(await upstream.arrayBuffer()))
          } catch (e) {
            res.statusCode = 502
            res.end('本地代理转发失败：' + (e instanceof Error ? e.message : String(e)))
          }
        })()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), corsProxy()],
  server: {
    port: 5173,
    strictPort: true,
  },
})
