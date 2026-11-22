/**
 * 本机后处理/服务桥的地址与请求封装。
 * 桥做三件事：跑超分补帧（/post）、跑成片质检（/qc）、启停本地 ComfyUI（/comfy/*）。
 */
// 在 Node 里跑脚本时没有 import.meta.env，兜底到默认地址（也方便单测）
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
export const BRIDGE = env?.VITE_POST_BRIDGE || 'http://127.0.0.1:8791'

export async function bridgeFetch(
  path: string,
  init?: RequestInit,
  timeoutMs = 60_000,
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(`${BRIDGE}${path}`, { ...init, signal: ctrl.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('后处理桥超时')
    throw new Error(
      '连不上本地桥：请先在项目目录跑 `npm run post:bridge`（默认 http://127.0.0.1:8791）',
    )
  } finally {
    clearTimeout(timer)
  }
}
