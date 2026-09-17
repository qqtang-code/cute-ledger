import { canAddAttachment, classifyFile, formatBytes } from './media'
import type { AttachmentKind } from './types'

export interface Rejection {
  name: string
  reason: string
}

export interface PreparedBatch {
  prepared: Array<{ file: File; kind: AttachmentKind }>
  rejections: Rejection[]
}

/**
 * 选完文件后先判定「能不能收」，不能收的要给原因（SPEC R5：不许静默丢）。
 * 这里只做判定，真正的压缩在 services/attachments 里做。
 */
export function screenFiles(
  files: File[],
  existing: Array<{ kind: AttachmentKind; sizeBytes: number }>,
): PreparedBatch {
  const prepared: Array<{ file: File; kind: AttachmentKind }> = []
  const rejections: Rejection[] = []
  const accepted = [...existing]

  for (const file of files) {
    const kind = classifyFile(file.type)
    if (kind === 'unsupported') {
      rejections.push({ name: file.name, reason: '只支持图片和视频' })
      continue
    }
    const check = canAddAttachment(accepted, kind, file.size)
    if (!check.ok) {
      rejections.push({ name: file.name, reason: check.reason })
      continue
    }
    // 图片压缩后体积会变小，这里先按原大小占位，避免一次选太多张超限
    accepted.push({ kind, sizeBytes: file.size })
    prepared.push({ file, kind })
  }

  return { prepared, rejections }
}

export function describeRejections(rejections: Rejection[]): string {
  if (rejections.length === 0) return ''
  if (rejections.length === 1) return `${rejections[0].name}：${rejections[0].reason}`
  const head = rejections
    .slice(0, 2)
    .map((r) => `${r.name}：${r.reason}`)
    .join('；')
  return rejections.length > 2 ? `${head}；还有 ${rejections.length - 2} 个被跳过` : head
}

export function totalBytes(list: Array<{ sizeBytes: number }>): string {
  return formatBytes(list.reduce((sum, item) => sum + item.sizeBytes, 0))
}