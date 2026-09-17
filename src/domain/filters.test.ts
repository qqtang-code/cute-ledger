import { describe, expect, test } from 'vitest'
import {
  describeFilters,
  emptyFiltersValue,
  filterExpenses,
  hasActiveFilters,
  matchesFilters,
  matchesText,
  paginate,
  sortExpensesDesc,
} from './filters'
import { makeExpense } from '../test/factories'
import type { ExpenseFilters } from './types'

const base: ExpenseFilters = { ...emptyFiltersValue }

describe('关键词匹配', () => {
  test('命中备注或标签，大小写不敏感', () => {
    const e = makeExpense({ note: 'Starbucks 拿铁', tags: ['咖啡', 'Work'] })
    expect(matchesText(e, 'starbucks')).toBe(true)
    expect(matchesText(e, '拿铁')).toBe(true)
    expect(matchesText(e, 'work')).toBe(true)
    expect(matchesText(e, '咖啡')).toBe(true)
    expect(matchesText(e, '奶茶')).toBe(false)
    expect(matchesText(e, '  ')).toBe(true)
  })

  test('空关键词不过滤', () => {
    expect(matchesFilters(makeExpense(), base)).toBe(true)
    expect(hasActiveFilters(base)).toBe(false)
  })
})

describe('筛选条件', () => {
  const e = makeExpense({
    amountCents: 12_345,
    categoryId: 'cat-food',
    spentAt: '2026-09-17',
    tags: ['午饭'],
    attachmentIds: ['a1'],
  })

  test('分类多选', () => {
    expect(matchesFilters(e, { ...base, categoryIds: ['cat-food'] })).toBe(true)
    expect(matchesFilters(e, { ...base, categoryIds: ['cat-food', 'cat-fun'] })).toBe(true)
    expect(matchesFilters(e, { ...base, categoryIds: ['cat-fun'] })).toBe(false)
  })

  test('日期区间含首尾', () => {
    expect(matchesFilters(e, { ...base, from: '2026-09-17', to: '2026-09-17' })).toBe(true)
    expect(matchesFilters(e, { ...base, from: '2026-09-18', to: null })).toBe(false)
    expect(matchesFilters(e, { ...base, from: null, to: '2026-09-16' })).toBe(false)
    expect(matchesFilters(e, { ...base, from: '2026-09-01', to: '2026-09-30' })).toBe(true)
  })

  test('金额区间含边界', () => {
    expect(matchesFilters(e, { ...base, minCents: 12_345, maxCents: 12_345 })).toBe(true)
    expect(matchesFilters(e, { ...base, minCents: 12_346 })).toBe(false)
    expect(matchesFilters(e, { ...base, maxCents: 12_344 })).toBe(false)
  })

  test('仅看有附件', () => {
    expect(matchesFilters(e, { ...base, onlyWithAttachments: true })).toBe(true)
    expect(matchesFilters(makeExpense(), { ...base, onlyWithAttachments: true })).toBe(false)
  })

  test('多个条件是与关系', () => {
    expect(matchesFilters(e, { ...base, categoryIds: ['cat-food'], minCents: 10_000, onlyWithAttachments: true })).toBe(true)
    expect(matchesFilters(e, { ...base, categoryIds: ['cat-food'], minCents: 99_999 })).toBe(false)
  })

  test('hasActiveFilters 能认出每一种条件', () => {
    expect(hasActiveFilters({ ...base, text: '咖啡' })).toBe(true)
    expect(hasActiveFilters({ ...base, categoryIds: ['x'] })).toBe(true)
    expect(hasActiveFilters({ ...base, from: '2026-09-01' })).toBe(true)
    expect(hasActiveFilters({ ...base, minCents: 0 })).toBe(true)
    expect(hasActiveFilters({ ...base, onlyWithAttachments: true })).toBe(true)
  })

  test('filterExpenses 批量过滤', () => {
    const list = [
      makeExpense({ id: 'a', categoryId: 'cat-food' }),
      makeExpense({ id: 'b', categoryId: 'cat-fun' }),
    ]
    expect(filterExpenses(list, { ...base, categoryIds: ['cat-fun'] }).map((e) => e.id)).toEqual(['b'])
  })
})

describe('排序与分页', () => {
  test('先按日期倒序，再按创建时间倒序', () => {
    const list = [
      makeExpense({ id: 'older', spentAt: '2026-09-01', createdAt: '2026-09-01T10:00:00.000Z' }),
      makeExpense({ id: 'sameDayEarly', spentAt: '2026-09-17', createdAt: '2026-09-17T08:00:00.000Z' }),
      makeExpense({ id: 'sameDayLate', spentAt: '2026-09-17', createdAt: '2026-09-17T20:00:00.000Z' }),
    ]
    expect(sortExpensesDesc(list).map((e) => e.id)).toEqual(['sameDayLate', 'sameDayEarly', 'older'])
  })

  test('分页给出 hasMore', () => {
    const list = Array.from({ length: 25 }, (_, i) => makeExpense({ id: `e${i}` }))
    expect(paginate(list, 0, 20)).toMatchObject({ hasMore: true })
    expect(paginate(list, 0, 20).items).toHaveLength(20)
    expect(paginate(list, 20, 20)).toMatchObject({ hasMore: false })
    expect(paginate(list, 20, 20).items).toHaveLength(5)
    expect(paginate(list, 100, 20).items).toEqual([])
  })
})

describe('筛选条件文案', () => {
  test('逐个条件生成可删除的标签', () => {
    const labels = describeFilters(
      {
        text: '咖啡',
        categoryIds: ['cat-food'],
        from: '2026-09-01',
        to: '2026-09-30',
        minCents: 1000,
        maxCents: 5000,
        onlyWithAttachments: true,
      },
      (id) => (id === 'cat-food' ? '餐饮' : id),
    )
    expect(labels).toEqual(['搜索：咖啡', '餐饮', '2026-09-01 ~ 2026-09-30', '10~50 元', '仅有附件'])
  })

  test('单边条件也有文案', () => {
    expect(describeFilters({ ...base, from: '2026-09-01' }, (id) => id)).toEqual(['2026-09-01 起'])
    expect(describeFilters({ ...base, maxCents: 5000 }, (id) => id)).toEqual(['≤ 50 元'])
    expect(describeFilters(base, (id) => id)).toEqual([])
  })
})