import { describe, expect, test } from 'vitest'
import {
  averagePerDayCents,
  barRatios,
  categoryBreakdown,
  comparePeriods,
  dailyTotals,
  donutSlices,
  maxExpense,
  summarize,
  topCategory,
  totalCents,
} from './stats'
import { makeExpense } from '../test/factories'

const list = [
  makeExpense({ id: 'a', amountCents: 1200, categoryId: 'cat-food', spentAt: '2026-09-01' }),
  makeExpense({ id: 'b', amountCents: 800, categoryId: 'cat-food', spentAt: '2026-09-01' }),
  makeExpense({ id: 'c', amountCents: 3000, categoryId: 'cat-shopping', spentAt: '2026-09-03' }),
  makeExpense({ id: 'd', amountCents: 50, categoryId: 'cat-transport', spentAt: '2026-09-05' }),
]

describe('合计与日均', () => {
  test('总额是整数分相加', () => {
    expect(totalCents(list)).toBe(5050)
    expect(totalCents([])).toBe(0)
  })

  test('日均按区间天数算，空区间给 0 不给 NaN', () => {
    expect(averagePerDayCents(list, '2026-09-01', '2026-09-05')).toBe(1010) // 5050 / 5
    expect(averagePerDayCents([], '2026-09-01', '2026-09-05')).toBe(0)
    expect(averagePerDayCents([], '2026-09-05', '2026-09-01')).toBe(0) // 反向区间
  })

  test('最大单笔', () => {
    expect(maxExpense(list)?.id).toBe('c')
    expect(maxExpense([])).toBeNull()
  })
})

describe('分类占比', () => {
  test('按金额倒序，占比之和为 1', () => {
    const slices = categoryBreakdown(list)
    expect(slices.map((s) => s.categoryId)).toEqual(['cat-shopping', 'cat-food', 'cat-transport'])
    expect(slices[0].totalCents).toBe(3000)
    expect(slices[1].count).toBe(2)
    const sum = slices.reduce((acc, s) => acc + s.ratio, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  test('空列表不产生 NaN', () => {
    expect(categoryBreakdown([])).toEqual([])
    expect(topCategory([])).toBeNull()
  })

  test('topCategory 取金额最大的分类', () => {
    expect(topCategory(list)?.categoryId).toBe('cat-shopping')
  })
})

describe('按天趋势', () => {
  test('缺失日期补 0，保证图表不断线', () => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']
    const totals = dailyTotals(list, dates)
    expect(totals.map((t) => t.totalCents)).toEqual([2000, 0, 3000, 0, 50])
  })

  test('柱状图比例：全 0 时返回全 0，不给 NaN', () => {
    expect(barRatios([0, 0, 0])).toEqual([0, 0, 0])
    expect(barRatios([50, 100, 25])).toEqual([0.5, 1, 0.25])
    expect(barRatios([])).toEqual([])
  })
})

describe('环比', () => {
  test('上涨 / 下跌 / 持平', () => {
    expect(comparePeriods(120, 100)).toMatchObject({ deltaCents: 20, direction: 'up' })
    expect(comparePeriods(80, 100)).toMatchObject({ deltaCents: -20, direction: 'down' })
    expect(comparePeriods(100, 100)).toMatchObject({ deltaCents: 0, direction: 'flat' })
  })

  test('上一周期为 0 时比例是 null，不允许 Infinity', () => {
    const cmp = comparePeriods(100, 0)
    expect(cmp.deltaRatio).toBeNull()
    expect(cmp.deltaCents).toBe(100)
    expect(Number.isFinite(cmp.deltaCents)).toBe(true)
  })

  test('比例为有理数', () => {
    expect(comparePeriods(150, 100).deltaRatio).toBeCloseTo(0.5, 10)
    expect(comparePeriods(50, 100).deltaRatio).toBeCloseTo(-0.5, 10)
  })
})

describe('汇总卡', () => {
  test('四个指标都对得上', () => {
    const s = summarize(list, '2026-09-01', '2026-09-30')
    expect(s.totalCents).toBe(5050)
    expect(s.count).toBe(4)
    expect(s.maxExpenseCents).toBe(3000)
    expect(s.averagePerDayCents).toBe(Math.round(5050 / 30))
  })

  test('空数据的汇总全是 0，不出现 NaN/Infinity', () => {
    const s = summarize([], '2026-09-01', '2026-09-30')
    expect(s).toEqual({ totalCents: 0, count: 0, averagePerDayCents: 0, maxExpenseCents: 0 })
  })
})

describe('环形图切片', () => {
  test('每个切片都拿到合法的 SVG path', () => {
    const slices = donutSlices(categoryBreakdown(list), 60, 18)
    expect(slices).toHaveLength(3)
    for (const s of slices) {
      expect(s.path).toMatch(/^M .+ A .+ L .+ A .+ Z$/)
      expect(s.path).not.toContain('NaN')
    }
  })

  test('只有一个分类（整圆）也能画出来，不出现起终点重合的空白', () => {
    const only = [makeExpense({ amountCents: 100, categoryId: 'cat-food' })]
    const slices = donutSlices(categoryBreakdown(only), 60, 18)
    expect(slices).toHaveLength(1)
    expect(slices[0].path).not.toContain('NaN')
    expect(slices[0].path.split('A').length - 1).toBe(2)
  })

  test('空数据返回空数组', () => {
    expect(donutSlices([], 60, 18)).toEqual([])
  })
})