import type { DateString } from './types'

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

/** Date → 'YYYY-MM-DD'（本地时区，不是 UTC） */
export function toDateString(d: Date): DateString {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'YYYY-MM-DD' → 本地午夜的 Date（不用 new Date(string)，那会按 UTC 解析） */
export function parseDateString(s: DateString): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return toDateString(parseDateString(s)) === s // 挡掉 2026-02-31 这种
}

export function addDays(s: DateString, n: number): DateString {
  const d = parseDateString(s)
  d.setDate(d.getDate() + n)
  return toDateString(d)
}

/** b - a 的天数差 */
export function daysBetween(a: DateString, b: DateString): number {
  const ms = parseDateString(b).getTime() - parseDateString(a).getTime()
  return Math.round(ms / 86_400_000)
}

/** 闭区间，含首尾；from > to 时返回空数组 */
export function daysInRange(from: DateString, to: DateString): DateString[] {
  const out: DateString[] = []
  const n = daysBetween(from, to)
  if (n < 0) return out
  for (let i = 0; i <= n; i++) out.push(addDays(from, i))
  return out
}

export function weekdayIndex(s: DateString): number {
  return parseDateString(s).getDay()
}

export function weekdayLabel(s: DateString): string {
  return `周${WEEKDAY_CN[weekdayIndex(s)]}`
}

/** 今天 / 昨天 / M月D日 */
export function formatDayLabel(s: DateString, today: DateString): string {
  const delta = daysBetween(s, today)
  if (delta === 0) return '今天'
  if (delta === 1) return '昨天'
  const d = parseDateString(s)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 'YYYY-MM' → '2026年9月' */
export function formatMonthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${y}年${m}月`
}

export function monthKey(s: DateString): string {
  return s.slice(0, 7)
}

/** 所在自然月的首尾 */
export function monthRangeOf(s: DateString): { from: DateString; to: DateString } {
  const [y, m] = s.split('-').map(Number)
  const last = new Date(y, m, 0).getDate() // 下个月 0 号 = 本月最后一天
  return { from: `${s.slice(0, 7)}-01`, to: `${s.slice(0, 7)}-${String(last).padStart(2, '0')}` }
}

/** 按月平移；31 号遇到短月自动夹到月末 */
export function shiftMonth(s: DateString, delta: number): DateString {
  const [y, m, d] = s.split('-').map(Number)
  const target = new Date(y, m - 1 + delta, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  const day = Math.min(d, lastDay)
  return toDateString(new Date(target.getFullYear(), target.getMonth(), day))
}

export type RangePreset = 'thisMonth' | 'lastMonth' | 'last30' | 'thisWeek' | 'today'

export function rangePreset(preset: RangePreset, today: DateString, weekStart: 0 | 1 = 1): { from: DateString; to: DateString } {
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'thisWeek': {
      const shift = (weekdayIndex(today) - weekStart + 7) % 7
      return { from: addDays(today, -shift), to: today }
    }
    case 'lastMonth': {
      const firstOfThisMonth = `${monthKey(today)}-01`
      const lastMonthDay = addDays(firstOfThisMonth, -1)
      return monthRangeOf(lastMonthDay)
    }
    case 'last30':
      return { from: addDays(today, -29), to: today }
    case 'thisMonth':
    default:
      return monthRangeOf(today)
  }
}

/** 等长的上一个周期，用于环比 */
export function previousPeriod(from: DateString, to: DateString): { from: DateString; to: DateString } {
  const n = daysBetween(from, to) + 1
  if (n <= 0) return { from, to }
  return { from: addDays(from, -n), to: addDays(from, -1) }
}

export interface DayGroup<T> {
  date: DateString
  items: T[]
  totalCents: number
}

/** 按 spentAt 倒序分天分组，每组带当日合计（整数分） */
export function groupByDay<T extends { spentAt: DateString; amountCents: number }>(items: T[]): DayGroup<T>[] {
  const map = new Map<DateString, T[]>()
  for (const item of items) {
    const bucket = map.get(item.spentAt)
    if (bucket) bucket.push(item)
    else map.set(item.spentAt, [item])
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, list]) => ({
      date,
      items: list,
      totalCents: list.reduce((sum, it) => sum + Math.round(it.amountCents), 0),
    }))
}

/** ISO 时间戳 → 'YYYY-MM-DD HH:mm'（本地） */
export function formatIsoDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${toDateString(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}