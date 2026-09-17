import { afterAll, describe, expect, test } from 'vitest'
import { createRepository } from './repository'
import { makeExpense } from '../test/factories'
import { closeAllAdapters, freshAdapter } from '../test/idb'
import { DEFAULT_CATEGORIES } from './migrations'

afterAll(() => {
  closeAllAdapters()
})

describe('仓储层的业务问题', () => {
  test('分类带引用计数（决定能不能硬删）', async () => {
    const adapter = await freshAdapter()
    await adapter.saveExpense(makeExpense({ id: 'e1', categoryId: 'cat-food' }))
    await adapter.saveExpense(makeExpense({ id: 'e2', categoryId: 'cat-food' }))
    const repo = createRepository(adapter)

    const withUsage = await repo.listCategoriesWithUsage()
    expect(withUsage).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(withUsage.find((c) => c.category.id === 'cat-food')?.expenseCount).toBe(2)
    expect(withUsage.find((c) => c.category.id === 'cat-fun')?.expenseCount).toBe(0)
  })

  test('标签按出现次数倒序列出（给联想用）', async () => {
    const adapter = await freshAdapter()
    await adapter.saveExpense(makeExpense({ id: 'e1', tags: ['咖啡', '工作日'] }))
    await adapter.saveExpense(makeExpense({ id: 'e2', tags: ['咖啡'] }))
    const repo = createRepository(adapter)
    expect(await repo.listTags()).toEqual(['咖啡', '工作日'])
  })

  test('本月汇总按自然月圈数据', async () => {
    const adapter = await freshAdapter()
    await adapter.saveExpense(makeExpense({ id: 'in1', spentAt: '2026-09-01', amountCents: 1000 }))
    await adapter.saveExpense(makeExpense({ id: 'in2', spentAt: '2026-09-30', amountCents: 2000 }))
    await adapter.saveExpense(makeExpense({ id: 'out', spentAt: '2026-08-31', amountCents: 9999 }))
    const repo = createRepository(adapter)

    const summary = await repo.monthSummary('2026-09-17')
    expect(summary.totalCents).toBe(3000)
    expect(summary.count).toBe(2)
    expect(summary.monthKey).toBe('2026-09')
  })

  test('只看未归档分类', async () => {
    const adapter = await freshAdapter()
    const repo = createRepository(adapter)
    const active = await repo.listActiveCategories()
    expect(active).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(active.every((c) => !c.archived)).toBe(true)
  })

  test('附件占用按字节累加', async () => {
    const adapter = await freshAdapter()
    await adapter.saveAttachment({
      id: 'a1',
      expenseId: 'e1',
      kind: 'image',
      blob: new Blob([new Uint8Array(10)]),
      mime: 'image/webp',
      sizeBytes: 10,
      createdAt: '2026-09-17T00:00:00.000Z',
    })
    await adapter.saveAttachment({
      id: 'a2',
      expenseId: 'e1',
      kind: 'video',
      blob: new Blob([new Uint8Array(90)]),
      mime: 'video/mp4',
      sizeBytes: 90,
      createdAt: '2026-09-17T00:00:00.000Z',
    })
    const repo = createRepository(adapter)
    expect(await repo.attachmentsBytes()).toBe(100)
  })
})