import type { ReactNode } from 'react'

/** 内联 SVG 插画：不用外部图片，离线也能显示 */
function CuteIllustration() {
  return (
    <svg width="140" height="120" viewBox="0 0 140 120" role="img" aria-label="空空的钱包插画">
      <ellipse cx="70" cy="104" rx="46" ry="8" fill="var(--c-primary-soft)" />
      <rect x="30" y="42" width="80" height="56" rx="14" fill="var(--c-primary-soft)" />
      <rect x="30" y="42" width="80" height="20" rx="10" fill="var(--c-primary)" opacity="0.55" />
      <circle cx="100" cy="72" r="7" fill="var(--c-surface)" />
      <circle cx="100" cy="72" r="3" fill="var(--c-primary)" />
      <circle cx="52" cy="30" r="5" fill="var(--c-accent)" />
      <path
        d="M70 18c-2-4-14-8-14-15 0-4.4 3.6-8 8-8 2.6 0 5 1.2 6 3 1-1.8 3.4-3 6-3 4.4 0 8 3.6 8 8 0 7-12 11-14 15z"
        fill="var(--c-primary)"
        opacity="0.75"
      />
    </svg>
  )
}

interface EmptyStateProps {
  title: string
  hint?: string
  action?: ReactNode
  testId?: string
}

export function EmptyState({ title, hint, action, testId }: EmptyStateProps) {
  return (
    <div className="empty" data-testid={testId}>
      <CuteIllustration />
      <p className="empty__title">{title}</p>
      {hint ? <p className="dim">{hint}</p> : null}
      {action}
    </div>
  )
}