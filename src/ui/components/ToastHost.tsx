import { useUiStore } from '../../store/ui'

export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts)
  const dismissToast = useUiStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="status" data-testid="toast">
          <span>{t.message}</span>
          {t.actionLabel ? (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                t.onAction?.()
                dismissToast(t.id)
              }}
            >
              {t.actionLabel}
            </button>
          ) : (
            <button type="button" className="toast__action" onClick={() => dismissToast(t.id)}>
              好
            </button>
          )}
        </div>
      ))}
    </div>
  )
}