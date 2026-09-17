import type { Expense, ExpenseFilters } from './types'

export const emptyFiltersValue: ExpenseFilters = {
  text: '',
  categoryIds: [],
  from: null,
  to: null,
  minCents: null,
  maxCents: null,
  onlyWithAttachments: false,
}

export function hasActiveFilters(f: ExpenseFilters): boolean {
  return (
    f.text.trim() !== '' ||
    f.categoryIds.length > 0 ||
    f.from !== null ||
    f.to !== null ||
    f.minCents !== null ||
    f.maxCents !== null ||
    f.onlyWithAttachments
  )
}

/** 关键词命中备注或标签（大小写不敏感，中文原样包含） */
export function matchesText(e: Expense, text: string): boolean {
  const q = text.trim().toLowerCase()
  if (q === '') return true
  if (e.note.toLowerCase().includes(q)) return true
  return e.tags.some((t) => t.toLowerCase().includes(q))
}

export function matchesFilters(e: Expense, f: ExpenseFilters): boolean {
  if (!matchesText(e, f.text)) return false
  if (f.categoryIds.length > 0 && !f.categoryIds.includes(e.categoryId)) return false
  if (f.from !== null && e.spentAt < f.from) return false
  if (f.to !== null && e.spentAt > f.to) return false
  if (f.minCents !== null && e.amountCents < f.minCents) return false
  if (f.maxCents !== null && e.amountCents > f.maxCents) return false
  if (f.onlyWithAttachments && e.attachmentIds.length === 0) return false
  return true
}

export function filterExpenses(list: Expense[], f: ExpenseFilters): Expense[] {
  return list.filter((e) => matchesFilters(e, f))
}

/** 倒序：先按消费日期，再按创建时间 */
export function sortExpensesDesc(list: Expense[]): Expense[] {
  return [...list].sort((a, b) => {
    if (a.spentAt !== b.spentAt) return a.spentAt < b.spentAt ? 1 : -1
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export function paginate<T>(list: T[], offset: number, limit: number): { items: T[]; hasMore: boolean } {
  const start = Math.max(0, offset)
  const items = list.slice(start, start + Math.max(0, limit))
  return { items, hasMore: start + items.length < list.length }
}

/** 筛选条件 → 可逐个删除的标签文案（SPEC R3） */
export function describeFilters(f: ExpenseFilters, categoryNameOf: (id: string) => string): string[] {
  const out: string[] = []
  if (f.text.trim()) out.push(`搜索：${f.text.trim()}`)
  for (const id of f.categoryIds) out.push(categoryNameOf(id))
  if (f.from && f.to) out.push(`${f.from} ~ ${f.to}`)
  else if (f.from) out.push(`${f.from} 起`)
  else if (f.to) out.push(`到 ${f.to}`)
  if (f.minCents !== null && f.maxCents !== null) out.push(`${f.minCents / 100}~${f.maxCents / 100} 元`)
  else if (f.minCents !== null) out.push(`≥ ${f.minCents / 100} 元`)
  else if (f.maxCents !== null) out.push(`≤ ${f.maxCents / 100} 元`)
  if (f.onlyWithAttachments) out.push('仅有附件')
  return out
}