import { formatCents } from '../../domain/money'
import type { Cents } from '../../domain/types'

interface AmountTextProps {
  cents: Cents
  symbol?: string
  className?: string
  /** 列表里用大字，统计里用更大或更小 */
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function AmountText({ cents, symbol = '¥', className = '', size = 'md' }: AmountTextProps) {
  return (
    <span className={`amount amount--${size} ${className}`.trim()} data-cents={cents}>
      {formatCents(cents, symbol)}
    </span>
  )
}