import { useEffect, useState } from 'react'
import type { Attachment } from '../../../domain/types'
import { attachmentService } from '../../../store/ledger'

export function useAttachment(id: string | null | undefined): { attachment: Attachment | null; url: string | null; failed: boolean } {
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    let created: string | null = null

    if (!id) {
      setAttachment(null)
      setUrl(null)
      setFailed(false)
      return
    }

    attachmentService
      .load(id)
      .then((record) => {
        if (!alive) return
        if (!record) {
          setFailed(true)
          return
        }
        created = URL.createObjectURL(record.blob)
        setAttachment(record)
        setUrl(created)
        setFailed(false)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })

    return () => {
      alive = false
      // 用完必须 revoke，否则列表滚久了内存一直涨
      if (created) URL.revokeObjectURL(created)
      setAttachment(null)
      setUrl(null)
    }
  }, [id])

  return { attachment, url, failed }
}

interface AttachmentThumbProps {
  id: string
  onOpen?: () => void
  showMeta?: boolean
}

export function AttachmentThumb({ id, onOpen, showMeta = false }: AttachmentThumbProps) {
  const { attachment, url, failed } = useAttachment(id)

  if (failed) {
    return (
      <div className="thumb thumb--missing" data-testid="thumb-missing" title="附件读不出来（可能被浏览器清理了）">
        <span aria-hidden="true">🫥</span>
        <span className="sr-only">附件读不出来</span>
      </div>
    )
  }

  if (!attachment || !url) return <div className="thumb thumb--loading" aria-hidden="true" />

  const label = attachment.kind === 'video' ? '▶' : ''

  return (
    <button type="button" className="thumb" onClick={onOpen} data-testid="attachment-thumb">
      {attachment.kind === 'video' ? (
        <>
          <video src={url} muted playsInline preload="metadata" />
          <span className="thumb__badge">{label}</span>
        </>
      ) : (
        <img src={url} alt="附件图片" loading="lazy" />
      )}
      {showMeta ? (
        <span className="thumb__meta">
          {attachment.width && attachment.height ? `${attachment.width}×${attachment.height} · ` : ''}
          {Math.round(attachment.sizeBytes / 1024)} KB
        </span>
      ) : null}
    </button>
  )
}