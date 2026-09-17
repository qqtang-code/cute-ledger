import type { Cents, DateString, Expense } from './types'
import { daysBetween } from './dates'

export interface CategorySlice {
  categoryId: string
  totalCents: Cents
  count: number
  /** 0..1；总额为 0 时是 0，不是 NaN */
  ratio: number
}

export interface Summary {
  totalCents: Cents
  count: number
  averagePerDayCents: Cents
  maxExpenseCents: Cents
}

export type TrendDirection = 'up' | 'down' | 'flat'

export interface PeriodComparison {
  currentCents: Cents
  previousCents: Cents
  deltaCents: Cents
  /** 上一周期为 0 时是 null（没法算比例，也不该显示 Infinity） */
  deltaRatio: number | null
  direction: TrendDirection
}

export function totalCents(expenses: Array<{ amountCents: Cents }>): Cents {
  let total = 0
  for (const e of expenses) total += Math.round(e.amountCents)
  return total
}

/** 日均：区间内总支出 / 天数（闭区间），空区间返回 0 */
export function averagePerDayCents(expenses: Array<{ amountCents: Cents }>, from: DateString, to: DateString): Cents {
  const days = daysBetween(from, to) + 1
  if (days <= 0) return 0
  return Math.round(totalCents(expenses) / days)
}

export function maxExpense(expenses: Expense[]): Expense | null {
  let best: Expense | null = null
  for (const e of expenses) {
    if (!best || e.amountCents > best.amountCents) best = e
  }
  return best
}

export function categoryBreakdown(expenses: Expense[]): CategorySlice[] {
  const map = new Map<string, { totalCents: number; count: number }>()
  for (const e of expenses) {
    const cur = map.get(e.categoryId) ?? { totalCents: 0, count: 0 }
    cur.totalCents += Math.round(e.amountCents)
    cur.count += 1
    map.set(e.categoryId, cur)
  }
  const total = totalCents(expenses)
  return [...map.entries()]
    .map(([categoryId, v]) => ({
      categoryId,
      totalCents: v.totalCents,
      count: v.count,
      ratio: total === 0 ? 0 : v.totalCents / total,
    }))
    .sort((a, b) => b.totalCents - a.totalCents || a.categoryId.localeCompare(b.categoryId))
}

export function topCategory(expenses: Expense[]): CategorySlice | null {
  return categoryBreakdown(expenses)[0] ?? null
}

/** 按天汇总，缺失的日期补 0（图表要连续，不能断） */
export function dailyTotals(expenses: Expense[], dates: DateString[]): Array<{ date: DateString; totalCents: Cents }> {
  const map = new Map<DateString, number>()
  for (const e of expenses) {
    map.set(e.spentAt, (map.get(e.spentAt) ?? 0) + Math.round(e.amountCents))
  }
  return dates.map((date) => ({ date, totalCents: map.get(date) ?? 0 }))
}

export function comparePeriods(currentCents: Cents, previousCents: Cents): PeriodComparison {
  const deltaCents = currentCents - previousCents
  const direction: TrendDirection = deltaCents > 0 ? 'up' : deltaCents < 0 ? 'down' : 'flat'
  return {
    currentCents,
    previousCents,
    deltaCents,
    deltaRatio: previousCents === 0 ? null : deltaCents / previousCents,
    direction,
  }
}

export function summarize(expenses: Expense[], from: DateString, to: DateString): Summary {
  const max = maxExpense(expenses)
  return {
    totalCents: totalCents(expenses),
    count: expenses.length,
    averagePerDayCents: averagePerDayCents(expenses, from, to),
    maxExpenseCents: max ? max.amountCents : 0,
  }
}

/** 柱状图高度比例（0..1），最大值为 0 时全部返回 0，不给 NaN */
export function barRatios(values: Cents[]): number[] {
  const max = values.reduce((m, v) => (v > m ? v : m), 0)
  if (max <= 0) return values.map(() => 0)
  return values.map((v) => v / max)
}

/** 环形图的 SVG 弧线参数（角度制，从 12 点方向顺时针） */
export function donutSlices(slices: CategorySlice[], radius: number, thickness: number): Array<CategorySlice & { path: string }> {
  const visible = slices.filter((s) => s.totalCents > 0)
  const total = visible.reduce((sum, s) => sum + s.totalCents, 0)
  if (total <= 0) return []

  const cx = radius
  const cy = radius
  const rOuter = radius
  const rInner = radius - thickness
  let angle = -90

  return visible.map((s) => {
    const sweep = (s.totalCents / total) * 360
    const start = angle
    const end = angle + sweep
    angle = end
    // 整圆（只有一个分类）时用两段半圆，避免起终点重合画不出来
    const capped = Math.min(end, start + 359.999)
    const p = (r: number, deg: number) => {
      const rad = (deg * Math.PI) / 180
      return `${(cx + r * Math.cos(rad)).toFixed(3)} ${(cy + r * Math.sin(rad)).toFixed(3)}`
    }
    const largeArc = capped - start > 180 ? 1 : 0
    const path = [
      `M ${p(rOuter, start)}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p(rOuter, capped)}`,
      `L ${p(rInner, capped)}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p(rInner, start)}`,
      'Z',
    ].join(' ')
    return { ...s, path }
  })
}