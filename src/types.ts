export type NodeType = 'image' | 'text' | 'generator' | 'video' | 'audio'

export type GenMode = 'image' | 'text' | 'video' | 'audio'

export interface CanvasNode {
  id: string
  type: NodeType
  x: number
  y: number
  width: number
  height: number
  /** image / video / audio 节点：媒体源（dataURL 或 URL） */
  src?: string
  /** text 节点：文本内容 */
  text?: string
  /** 媒体节点：显示名（如上传文件名） */
  name?: string
  /** generator 节点 */
  prompt?: string
  providerId?: string
  model?: string
  mode?: GenMode
  /** audio 生成：TTS 音色 */
  voice?: string
  status?: 'idle' | 'running' | 'error'
  error?: string
  /** 编组 id：同组节点点选任一成员即全组选中 */
  groupId?: string
  /** running 时的进度提示（如视频任务轮询状态） */
  progress?: string
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
