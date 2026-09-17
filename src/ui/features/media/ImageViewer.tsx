import { useEffect } from 'react'
import { useUiStore } from '../../../store/ui'
import { useAttachment } from './AttachmentThumb'

/** 全屏看大图 / 放视频；左右键或按钮翻页 */
export function ImageViewer() {
  const viewer = useUiStore((s) => s.viewer)
  const closeViewer = useUiStore((s) => s.closeViewer)
  const stepViewer = useUiStore((s) => s.stepViewer)
  const currentId = viewer ? viewer.ids[viewer.index] : null
  const { attachment, url, failed } = useAttachment(currentId)

  useEffect(() => {
    if (!viewer) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeViewer()
      if (event.key === 'ArrowRight') stepViewer(1)
      if (event.key === 'ArrowLeft') stepViewer(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer, closeViewer, stepViewer])

  if (!viewer || !currentId) return null

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="查看附件" data-testid="image-viewer">
      <div className="viewer__bar">
        <span className="viewer__count">
          {viewer.index + 1} / {viewer.ids.length}
        </span>
        <button type="button" className="icon-btn icon-btn--light" onClick={closeViewer} aria-label="关闭">
          ✕
        </button>
      </div>

      <div className="viewer__stage">
        {failed ? (
          <p className="viewer__error">这个附件读不出来了</p>
        ) : !url ? (
          <p className="viewer__error">加载中…</p>
        ) : attachment?.kind === 'video' ? (
          <video src={url} controls autoPlay playsInline className="viewer__media" />
        ) : (
          <img src={url} alt="附件大图" className="viewer__media" />
        )}
      </div>

      {viewer.ids.length > 1 ? (
        <div className="viewer__nav">
          <button type="button" className="btn btn--ghost" onClick={() => stepViewer(-1)} aria-label="上一个">
            ←
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => stepViewer(1)} aria-label="下一个">
            →
          </button>
        </div>
      ) : null}
    </div>
  )
}