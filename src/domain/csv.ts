import type { Category, Expense } from './types'
import { centsToPlainString } from './money'

export const CSV_BOM = '\uFEFF'

/** 含逗号/引号/换行就加引号，内部引号翻倍 */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function buildCsv(rows: Array<Array<string | number>>): string {
  return CSV_BOM + rows.map((row) => row.map((cell) => csvEscape(String(cell))).join(',')).join('\r\n')
}

export const EXPENSE_CSV_HEADER = ['日期', '金额', '分类', '备注', '标签', '附件数'] as const

/** 导出给 Excel 用：UTF-8 带 BOM，Excel 打开不乱码 */
export function expensesToCsv(expenses: Expense[], categories: Category[]): string {
  const nameOf = new Map(categories.map((c) => [c.id, c.archived ? `${c.name}(已归档)` : c.name]))
  const rows: Array<Array<string | number>> = [Array.from(EXPENSE_CSV_HEADER)]

  const sorted = [...expenses].sort((a, b) =>
    a.spentAt === b.spentAt ? a.createdAt.localeCompare(b.createdAt) : a.spentAt < b.spentAt ? 1 : -1,
  )

  for (const e of sorted) {
    rows.push([
      e.spentAt,
      centsToPlainString(e.amountCents),
      nameOf.get(e.categoryId) ?? '未分类',
      e.note,
      e.tags.join(' '),
      e.attachmentIds.length,
    ])
  }
  return buildCsv(rows)
}