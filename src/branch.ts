/** 以某张结果卡为参考开新分支：新建生成节点并连线，绝不覆盖原结果 */
import { useStore } from './store'
import { useUI } from './ui'
import { uid, type CanvasNode, type GenMode } from './types'

export function iterateFromNode(node: CanvasNode) {
  if (node.type !== 'image' && node.type !== 'text') return
  const s = useStore.getState()
  // 找上游生成节点，继承提供商与模型（模式一致时才继承模型）
  const upEdge = s.edges.find((e) => e.to === node.id && s.nodes[e.from]?.type === 'generator')
  const upGen = upEdge ? s.nodes[upEdge.from] : undefined
  const mode: GenMode = node.type === 'text' ? 'text' : 'image'
  const gen: CanvasNode = {
    id: uid(),
    type: 'generator',
    x: node.x + node.width + 80,
    y: node.y,
    width: 260,
    height: 150,
    prompt: '',
    mode,
    providerId: upGen?.providerId,
    model: upGen && (upGen.mode ?? 'image') === mode ? upGen.model : undefined,
    status: 'idle',
  }
  s.addNode(gen)
  s.addEdge({ id: uid(), from: node.id, to: gen.id })
  s.setSelection([gen.id])
  useUI.getState().requestPromptFocus()
}
