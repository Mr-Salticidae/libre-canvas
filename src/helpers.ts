export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** 读取视频元数据，返回按 maxSide 缩放后的节点尺寸。坏文件不报 error 事件也会挂起，须超时兜底 */
export function loadVideoMeta(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    const timer = setTimeout(() => reject(new Error('视频元数据读取超时，文件可能已损坏')), 10_000)
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      clearTimeout(timer)
      resolve(fitSize(v.videoWidth || 640, v.videoHeight || 360))
    }
    v.onerror = () => {
      clearTimeout(timer)
      reject(new Error('视频加载失败'))
    }
    v.src = src
  })
}

/** 按最长边缩放到 maxSide，返回节点尺寸 */
export function fitSize(w: number, h: number, maxSide = 420) {
  const ratio = Math.min(1, maxSide / Math.max(w, h))
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) }
}

export function download(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
