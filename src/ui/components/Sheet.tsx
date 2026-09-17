import type { ReactNode } from 'react'
import { useEffect } from 'react'

interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  testId?: string
}

/** 底部弹层：手机上好按，桌面居中看也不别扭 */
export function Sheet({ title, onClose, children, footer, testId }: SheetProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} data-testid={`${testId ?? 'sheet'}-backdrop`} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
        <div className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="sheet__body">{children}</div>
        {footer ? <div className="sheet__footer">{footer}</div> : null}
      </div>
    </>
  )
}