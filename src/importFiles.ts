import { useStore } from './store'
import { uid } from './types'
import { fileToDataURL, fitSize, loadImage, loadVideoMeta } from './helpers'

const MAX_FILE_MB = 100

/** 上传/拖入文件 → 画布节点。图片、视频、音频、文本(.txt/.md)按类型分流。 */
export async function importFilesToCanvas(files: File[], at: { x: number; y: number }) {
  const addNode = useStore.getState().addNode
  const skipped: string[] = []
  let offset = 0

  for (const file of files) {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      skipped.push(`${file.name}（超过 ${MAX_FILE_MB}MB）`)
      continue
    }
    const pos = { x: at.x + offset, y: at.y + offset }
    try {
      if (file.type.startsWith('image/')) {
        const src = await fileToDataURL(file)
        const img = await loadImage(src)
        const { width, height } = fitSize(img.naturalWidth, img.naturalHeight)
        addNode({ id: uid(), type: 'image', ...pos, width, height, src, name: file.name })
      } else if (file.type.startsWith('video/')) {
        const src = await fileToDataURL(file)
        const { width, height } = await loadVideoMeta(src)
        addNode({ id: uid(), type: 'video', ...pos, width, height, src, name: file.name })
      } else if (file.type.startsWith('audio/')) {
        const src = await fileToDataURL(file)
        addNode({ id: uid(), type: 'audio', ...pos, width: 280, height: 84, src, name: file.name })
      } else if (file.type.startsWith('text/') || /\.(txt|md|markdown)$/i.test(file.name)) {
        const text = await file.text()
        addNode({ id: uid(), type: 'text', ...pos, width: 360, height: 120, text, name: file.name })
      } else {
        skipped.push(`${file.name}（不支持的类型 ${file.type || '未知'}）`)
        continue
      }
      offset += 32
    } catch (e) {
      skipped.push(`${file.name}（${e instanceof Error ? e.message : '读取失败'}）`)
    }
  }

  if (skipped.length > 0) alert(`以下文件未导入：\n${skipped.join('\n')}`)
}
