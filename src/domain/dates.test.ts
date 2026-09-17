import { describe, expect, test } from 'vitest'
import {
  addDays,
  daysBetween,
  daysInRange,
  formatDayLabel,
  formatIsoDateTime,
  formatMonthLabel,
  groupByDay,
  isValidDateString,
  monthKey,
  monthRangeOf,
  parseDateString,
  previousPeriod,
  rangePreset,
  shiftMonth,
  toDateString,
  weekdayIndex,
  weekdayLabel,
} from './dates'
import { makeExpense } from '../test/factories'

describe('日期字符串', () => {
  test('Date ↔ YYYY-MM-DD 互转用本地时区，不走 UTC', () => {
    expect(toDateString(new Date(2026, 8, 17, 23, 30))).toBe('2026-09-17')
    expect(toDateString(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
    const d = parseDateString('2026-09-17')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(17)
    expect(d.getHours()).toBe(0)
  })

  test('非法日期被识别出来（2026-02-31 不存在）', () => {
    expect(isValidDateString('2026-09-17')).toBe(true)
    expect(isValidDateString('2026-02-31')).toBe(false)
    expect(isValidDateString('2026-13-01')).toBe(false)
    expect(isValidDateString('26-09-17')).toBe(false)
    expect(isValidDateString('2026/09/17')).toBe(false)
  })

  test('跨月跨年加减天数', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  test('天数差与区间', () => {
    expect(daysBetween('2026-09-17', '2026-09-17')).toBe(0)
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
    expect(daysBetween('2026-09-01', '2026-09-30')).toBe(29)
    expect(daysInRange('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ])
    expect(daysInRange('2026-09-02', '2026-09-01')).toEqual([])
  })

  test('星期标签', () => {
    expect(weekdayIndex('2026-09-17')).toBe(parseDateString('2026-09-17').getDay())
    expect(weekdayLabel('2026-09-17')).toMatch(/^周[日一二三四五六]$/)
  })
})

describe('月份处理', () => {
  test('取自然月首尾（含闰年判断）', () => {
    expect(monthRangeOf('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRangeOf('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthRangeOf('2026-09-30')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })

  test('monthKey / formatMonthLabel', () => {
    expect(monthKey('2026-09-17')).toBe('2026-09')
    expect(formatMonthLabel('2026-09')).toBe('2026年9月')
  })

  test('按月平移时把 31 号夹到短月月末', () => {
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftMonth('2026-03-31', -1)).toBe('2026-02-28')
    expect(shiftMonth('2026-09-17', 1)).toBe('2026-10-17')
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-15')
  })
})

describe('区间预设与环比周期', () => {
  test('本月 / 上月 / 近30天', () => {
    expect(rangePreset('thisMonth', '2026-09-17')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(rangePreset('lastMonth', '2026-09-17')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(rangePreset('last30', '2026-09-17')).toEqual({ from: '2026-08-19', to: '2026-09-17' })
    expect(rangePreset('today', '2026-09-17')).toEqual({ from: '2026-09-17', to: '2026-09-17' })
  })

  test('本周区间一定从周一开始且不超过 7 天', () => {
    const { from, to } = rangePreset('thisWeek', '2026-09-17', 1)
    expect(parseDateString(from).getDay()).toBe(1)
    expect(daysBetween(from, to)).toBeLessThan(7)
    expect(daysBetween(from, to)).toBeGreaterThanOrEqual(0)
  })

  test('环比取等长的上一周期', () => {
    expect(previousPeriod('2026-09-01', '2026-09-30')).toEqual({ from: '2026-08-02', to: '2026-08-31' })
    expect(previousPeriod('2026-09-17', '2026-09-17')).toEqual({ from: '2026-09-16', to: '2026-09-16' })
  })
})

describe('按天分组', () => {
  test('倒序分组、带当日合计', () => {
    const list = [
      makeExpense({ id: 'a', spentAt: '2026-09-17', amountCents: 100 }),
      makeExpense({ id: 'b', spentAt: '2026-09-17', amountCents: 250 }),
      makeExpense({ id: 'c', spentAt: '2026-09-15', amountCents: 999 }),
    ]
    const groups = groupByDay(list)
    expect(groups.map((g) => g.date)).toEqual(['2026-09-17', '2026-09-15'])
    expect(groups[0].totalCents).toBe(350)
    expect(groups[0].items).toHaveLength(2)
    expect(groups[1].totalCents).toBe(999)
  })

  test('空列表返回空数组', () => {
    expect(groupByDay([])).toEqual([])
  })
})

describe('给人看的日期文案', () => {
  test('今天 / 昨天 / 具体日期', () => {
    expect(formatDayLabel('2026-09-17', '2026-09-17')).toBe('今天')
    expect(formatDayLabel('2026-09-16', '2026-09-17')).toBe('昨天')
    expect(formatDayLabel('2026-09-01', '2026-09-17')).toBe('9月1日')
  })

  test('ISO 时间戳按本地时区显示', () => {
    const iso = new Date(2026, 8, 17, 8, 5).toISOString()
    expect(formatIsoDateTime(iso)).toBe('2026-09-17 08:05')
  })
})