export type NodeType = 'image' | 'text' | 'generator'

export interface CanvasNode {
  id: string
  type: NodeType
  x: number
  y: number
  width: number
  height: number
  /** image 节点：图片源（dataURL 或 URL） */
  src?: string
  /** text 节点：文本内容 */
  text?: string
  /** generator 节点 */
  prompt?: string
  providerId?: string
  model?: string
  mode?: 'image' | 'text'
  status?: 'idle' | 'running' | 'error'
  error?: string
}

/** 轻连线：记录生成血缘（生成节点 → 产物） */
export interface Edge {
  id: string
  from: string
  to: string
}

export interface Provider {
  id: string
  name: string
  /** OpenAI 兼容接口的 base URL，通常以 /v1 结尾 */
  baseURL: string
  apiKey: string
  /** 可选模型列表，逗号分隔填写 */
  models: string[]
}

export interface Doc {
  nodes: Record<string, CanvasNode>
  edges: Edge[]
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
