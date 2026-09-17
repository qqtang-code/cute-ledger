import { useEffect, useMemo, useRef, useState } from 'react'
import { describeRejections, screenFiles, type Rejection } from '../../../domain/upload'
import { formatBytes } from '../../../domain/media'
import type { AttachmentKind } from '../../../domain/types'
import { prepareAttachment, releasePreview, type PendingAttachment } from '../../../services/attachments'
import { attachmentService } from '../../../store/ledger'

interface AttachmentPickerProps {
  /** 编辑时已经存在的附件（只给了 id，要展示缩略图得单独取） */
  kept: string[]
  onKeptChange: (ids: string[]) => void
  pending: PendingAttachment[]
  onPendingChange: (list: PendingAttachment[]) => void
  onRejections: (message: string) => void
}

export function AttachmentPicker({ kept, onKeptChange, pending, onPendingChange, onRejections }: AttachmentPickerProps) {
  const galleryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [keptMeta, setKeptMeta] = useState<Array<{ id: string; kind: AttachmentKind; sizeBytes: number; caption: string }>>([])

  useEffect(() => {
    let alive = true
    Promise.all(
      kept.map(async (id) => {
        const record = await attachmentService.load(id)
        if (!record) return { id, kind: 'image' as AttachmentKind, sizeBytes: 0, caption: '读不出来' }
        const dims = record.width && record.height ? `${record.width}×${record.height} · ` : ''
        return { id, kind: record.kind, sizeBytes: record.sizeBytes, caption: `${dims}${formatBytes(record.sizeBytes)}` }
      }),
    ).then((list) => {
      if (alive) setKeptMeta(list)
    })
    return () => {
      alive = false
    }
  }, [kept])

  // 组件卸载时把没保存的预览 URL 放掉，防内存泄漏
  const pendingRef = useRef<PendingAttachment[]>([])
  pendingRef.current = pending
  useEffect(
    () => () => {
      for (const item of pendingRef.current) releasePreview(item)
    },
    [],
  )

  const existing = useMemo(
    () => [
      ...keptMeta.map((k) => ({ kind: k.kind, sizeBytes: k.sizeBytes })),
      ...pending.map((p) => ({ kind: p.kind, sizeBytes: p.sizeBytes })),
    ],
    [keptMeta, pending],
  )

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setBusy(true)
    try {
      const { prepared, rejections } = screenFiles(Array.from(fileList), existing)
      const added: PendingAttachment[] = []
      for (const item of prepared) {
        try {
          added.push(await prepareAttachment(item.file, item.kind))
        } catch (error) {
          rejections.push({
            name: item.file.name,
            reason: error instanceof Error ? error.message : '处理失败',
          })
        }
      }
      if (added.length > 0) onPendingChange([...pending, ...added])
      if (rejections.length > 0) onRejections(describeRejections(rejections as Rejection[]))
    } finally {
      setBusy(false)
      if (galleryRef.current) galleryRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
    }
  }

  return (
    <div className="picker" data-testid="attachment-picker">
      <div className="picker__grid">
        {keptMeta.map((item) => (
          <KeptPreview
            key={item.id}
            id={item.id}
            kind={item.kind}
            caption={item.caption}
            onRemove={() => onKeptChange(kept.filter((id) => id !== item.id))}
          />
        ))}

        {pending.map((item) => (
          <div className="picker__item" key={item.id} data-testid="pending-attachment">
            {item.kind === 'video' ? (
              <video src={item.previewUrl} muted playsInline />
            ) : (
              <img src={item.previewUrl} alt="待保存的图片" />
            )}
            <span className="picker__caption">
              {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
              {formatBytes(item.sizeBytes)}
            </span>
            <button
              type="button"
              className="picker__remove"
              aria-label="移除这个附件"
              onClick={() => {
                releasePreview(item)
                onPendingChange(pending.filter((p) => p.id !== item.id))
              }}
            >
              ✕
            </button>
          </div>
        ))}

        <button
          type="button"
          className="picker__add"
          onClick={() => galleryRef.current?.click()}
          disabled={busy}
          data-testid="pick-gallery"
        >
          <span aria-hidden="true">🖼️</span>
          <span>{busy ? '处理中…' : '相册'}</span>
        </button>
        <button
          type="button"
          className="picker__add"
          onClick={() => cameraRef.current?.click()}
          disabled={busy}
          data-testid="pick-camera"
        >
          <span aria-hidden="true">📷</span>
          <span>拍照</span>
        </button>
      </div>

      <input
        ref={galleryRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="sr-only"
        aria-label="选择图片或视频"
        data-testid="file-input"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="拍一张"
        data-testid="camera-input"
        onChange={(event) => void handleFiles(event.target.files)}
      />
    </div>
  )
}

function KeptPreview({
  id,
  kind,
  caption,
  onRemove,
}: {
  id: string
  kind: AttachmentKind
  caption: string
  onRemove: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let created: string | null = null
    attachmentService.load(id).then((record) => {
      if (!alive || !record) return
      created = URL.createObjectURL(record.blob)
      setUrl(created)
    })
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [id])

  return (
    <div className="picker__item" data-testid="kept-attachment">
      {url ? (
        kind === 'video' ? (
          <video src={url} muted playsInline />
        ) : (
          <img src={url} alt="已保存的图片" />
        )
      ) : (
        <div className="picker__placeholder" aria-hidden="true" />
      )}
      <span className="picker__caption">{caption}</span>
      <button type="button" className="picker__remove" aria-label="移除这个附件" onClick={onRemove}>
        ✕
      </button>
    </div>
  )
}