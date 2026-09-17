import type { Cents } from './types'

export type BudgetLevel = 'ok' | 'warn' | 'over'

/** SPEC R7：<80% 绿、80–100% 黄、>100% 红 */
export const BUDGET_WARN_RATIO = 0.8

export interface BudgetProgress {
  hasBudget: boolean
  spentCents: Cents
  budgetCents: Cents
  /** 0..1+ ；没设预算时是 0，不是 NaN/Infinity */
  ratio: number
  /** 进度条宽度：夹在 0..1 */
  barRatio: number
  level: BudgetLevel
  remainingCents: Cents
  overCents: Cents
}

export function budgetLevel(ratio: number): BudgetLevel {
  if (ratio > 1) return 'over'
  if (ratio >= BUDGET_WARN_RATIO) return 'warn'
  return 'ok'
}

export function budgetProgress(spentCents: Cents, budgetCents: Cents): BudgetProgress {
  const spent = Math.round(spentCents)
  const budget = Math.round(budgetCents)

  if (budget <= 0) {
    return {
      hasBudget: false,
      spentCents: spent,
      budgetCents: 0,
      ratio: 0,
      barRatio: 0,
      level: 'ok',
      remainingCents: 0,
      overCents: 0,
    }
  }

  const ratio = spent / budget
  return {
    hasBudget: true,
    spentCents: spent,
    budgetCents: budget,
    ratio,
    barRatio: Math.max(0, Math.min(1, ratio)),
    level: budgetLevel(ratio),
    remainingCents: Math.max(0, budget - spent),
    overCents: Math.max(0, spent - budget),
  }
}

export function budgetLevelLabel(level: BudgetLevel): string {
  switch (level) {
    case 'over':
      return '超支'
    case 'warn':
      return '接近上限'
    default:
      return '充裕'
  }
}