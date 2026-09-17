import {
  IMAGE_MAX_BYTES,
  IMAGE_QUALITY,
  extensionForMime,
  pickImageMime,
  planImageCompression,
} from '../domain/media'
import type { Attachment, Id } from '../domain/types'
import type { StorageAdapter } from '../data/ports'
import { newId } from './ids'

/** 压缩时如果还是超过目标体积，就依次降质量重试 */
export const QUALITY_LADDER = [IMAGE_QUALITY, 0.6, 0.45] as const

let webpSupport: boolean | null = null

/** Safari 16.4 以下不支持 canvas 编码 WebP，要退 JPEG */
export function supportsWebpEncode(): boolean {
  if (webpSupport !== null) return webpSupport
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    webpSupport = false
  }
  return webpSupport
}

export class UnsupportedFileError extends Error {}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), mime, quality))
}

export interface CompressedImage {
  blob: Blob
  mime: string
  width: number
  height: number
}

/**
 * 把用户选的图片压到「长边 ≤1600、质量 0.8、尽量 ≤800KB」再入库。
 * 压不动（格式解不开）就抛错，由调用方提示用户跳过，绝不静默丢。
 */
export async function compressImageFile(file: File): Promise<CompressedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new UnsupportedFileError(`「${file.name}」这张图读不出来，已跳过`)
  }

  const plan = planImageCompression(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = plan.width
  canvas.height = plan.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new UnsupportedFileError('这个浏览器画不了图，没法压缩')
  ctx.drawImage(bitmap, 0, 0, plan.width, plan.height)
  bitmap.close?.()

  const mime = pickImageMime(supportsWebpEncode())
  let best: Blob | null = null
  for (const quality of QUALITY_LADDER) {
    const blob = await canvasToBlob(canvas, mime, quality)
    if (!blob) break
    best = blob
    if (blob.size <= IMAGE_MAX_BYTES) break
  }
  if (!best) throw new UnsupportedFileError(`「${file.name}」压缩失败，已跳过`)
  if (best.size > IMAGE_MAX_BYTES) best = file.size < best.size ? file : best // 压完还不如原图就别用压缩结果

  return { blob: best, mime: best.type || mime, width: plan.width, height: plan.height }
}

export interface PendingAttachment {
  id: Id
  kind: 'image' | 'video'
  file: File
  previewUrl: string
  width?: number
  height?: number
  sizeBytes: number
}

/** 选完文件先做成「待保存」的附件（还没写库），表单里能预览、能删 */
export async function prepareAttachment(file: File, kind: 'image' | 'video'): Promise<PendingAttachment> {
  if (kind === 'video') {
    return {
      id: newId(),
      kind,
      file,
      previewUrl: URL.createObjectURL(file),
      sizeBytes: file.size,
    }
  }
  const compressed = await compressImageFile(file)
  const compressedFile = new File([compressed.blob], file.name, { type: compressed.mime })
  return {
    id: newId(),
    kind,
    file: compressedFile,
    previewUrl: URL.createObjectURL(compressed.blob),
    width: compressed.width,
    height: compressed.height,
    sizeBytes: compressed.blob.size,
  }
}

/** 待保存附件 → 落库记录 */
export function toAttachmentRecord(pending: PendingAttachment, expenseId: Id, now: Date): Attachment {
  return {
    id: pending.id,
    expenseId,
    kind: pending.kind,
    blob: pending.file,
    mime: pending.file.type || (pending.kind === 'image' ? 'image/webp' : 'video/mp4'),
    width: pending.width,
    height: pending.height,
    sizeBytes: pending.sizeBytes,
    createdAt: now.toISOString(),
  }
}

export function releasePreview(pending: PendingAttachment): void {
  URL.revokeObjectURL(pending.previewUrl)
}

export interface AttachmentService {
  savePending(expenseId: Id, pending: PendingAttachment[], now?: Date): Promise<number>
  replaceForExpense(expenseId: Id, keepIds: Id[], pending: PendingAttachment[], now?: Date): Promise<void>
  removeAttachment(id: Id): Promise<void>
  load(id: Id): Promise<Attachment | null>
  usage(): Promise<{ usedBytes: number; quotaBytes: number }>
  requestPersistence(): Promise<boolean>
  exportedName(attachment: Attachment): string
}

export function createAttachmentService(adapter: StorageAdapter): AttachmentService {
  return {
    async savePending(expenseId, pending, now = new Date()) {
      for (const item of pending) {
        await adapter.saveAttachment(toAttachmentRecord(item, expenseId, now))
      }
      return pending.length
    },

    /** 编辑时用：删掉不在 keepIds 里的旧附件，再把新选的写进去 */
    async replaceForExpense(expenseId, keepIds, pending, now = new Date()) {
      const existing = await adapter.listAttachments(expenseId)
      for (const attachment of existing) {
        if (!keepIds.includes(attachment.id)) await adapter.deleteAttachment(attachment.id)
      }
      for (const item of pending) {
        await adapter.saveAttachment(toAttachmentRecord(item, expenseId, now))
      }
    },

    async removeAttachment(id) {
      await adapter.deleteAttachment(id)
    },

    async load(id) {
      const attachment = await adapter.getAttachment(id)
      return attachment ?? null
    },

    async usage() {
      return adapter.usage()
    },

    /**
     * 申请持久化存储（iOS Safari 不支持，返回 false，由界面提示用户定期导出备份）。
     * 链接到 SPEC R5。
     */
    async requestPersistence() {
      if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
      try {
        return await navigator.storage.persist()
      } catch {
        return false
      }
    },

    exportedName(attachment) {
      return `${attachment.id}.${extensionForMime(attachment.mime)}`
    },
  }
}