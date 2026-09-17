import type { AttachmentKind } from './types'

/** 图片长边上限（SPEC R5） */
export const IMAGE_MAX_EDGE = 1600
export const IMAGE_QUALITY = 0.8
export const IMAGE_MAX_BYTES = 800 * 1024
export const MAX_IMAGES_PER_EXPENSE = 9

export const VIDEO_MAX_BYTES = 25 * 1024 * 1024
export const MAX_VIDEOS_PER_EXPENSE = 1

export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 12

export interface ImagePlan {
  width: number
  height: number
  needsResize: boolean
}

/**
 * 计算压缩后的目标尺寸：长边不超过 maxEdge，等比缩放，最短 1px。
 * 不放大（原图本来就小就原样输出）。
 */
export function planImageCompression(width: number, height: number, maxEdge: number = IMAGE_MAX_EDGE): ImagePlan {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const longest = Math.max(w, h)

  if (longest <= maxEdge) return { width: w, height: h, needsResize: false }

  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    needsResize: true,
  }
}

/** 浏览器能编码 WebP 就用 WebP，老 Safari 退 JPEG */
export function pickImageMime(supportsWebp: boolean): 'image/webp' | 'image/jpeg' {
  return supportsWebp ? 'image/webp' : 'image/jpeg'
}

export type FileKind = 'image' | 'video' | 'unsupported'

export function classifyFile(mimeType: string): FileKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return 'unsupported'
}

export interface AttachmentLike {
  kind: AttachmentKind
  sizeBytes: number
}

export function countAttachments(list: AttachmentLike[]): { images: number; videos: number } {
  return {
    images: list.filter((a) => a.kind === 'image').length,
    videos: list.filter((a) => a.kind === 'video').length,
  }
}

export type AddCheck = { ok: true } | { ok: false; reason: string }

/** 判断还能不能加这个附件；不能加要给用户看得懂的原因，不静默丢弃 */
export function canAddAttachment(existing: AttachmentLike[], kind: AttachmentKind, sizeBytes: number): AddCheck {
  const { images, videos } = countAttachments(existing)

  if (kind === 'image') {
    if (images >= MAX_IMAGES_PER_EXPENSE) return { ok: false, reason: `最多 ${MAX_IMAGES_PER_EXPENSE} 张图片` }
    return { ok: true }
  }

  if (videos >= MAX_VIDEOS_PER_EXPENSE) return { ok: false, reason: `最多 ${MAX_VIDEOS_PER_EXPENSE} 个视频` }
  if (sizeBytes > VIDEO_MAX_BYTES) {
    return { ok: false, reason: `视频不能超过 ${formatBytes(VIDEO_MAX_BYTES)}（这个 ${formatBytes(sizeBytes)}）` }
  }
  return { ok: true }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 附件 id → 文件名后缀，用于导出 zip */
export function extensionForMime(mime: string): string {
  const map: Record<string, string> = {
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  }
  return map[mime] ?? (mime.split('/')[1] || 'bin')
}

export function mimeForExtension(ext: string): string {
  const map: Record<string, string> = {
    webp: 'image/webp',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    heic: 'image/heic',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
  }
  return map[ext.toLowerCase()] ?? 'application/octet-stream'
}

/** 标签清洗：去空白、去重、限长限量 */
export function normalizeTags(input: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    const tag = raw.trim().replace(/^#/, '').slice(0, MAX_TAG_LENGTH)
    if (tag === '' || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= MAX_TAGS) break
  }
  return out
}