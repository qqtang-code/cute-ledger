import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { emptyFiltersValue } from '../../domain/filters'
import type { Settings } from '../../domain/types'
import { makeAttachment, makeCategory, makeExpense, makeSettings } from '../../test/factories'
import { closeAllAdapters, freshAdapter, newAdapter } from '../../test/idb'
import { DEFAULT_CATEGORIES, DB_VERSION } from '../migrations'
import type { IndexedDbAdapter } from './indexeddb'

let adapter: IndexedDbAdapter
beforeEach(async () => {
  adapter = await freshAdapter()
})
afterAll(() => {
  closeAllAdapters()
})

describe('建库与默认数据', () => {
  test('schemaVersion 等于 DB_VERSION', async () => {
    expect(await adapter.schemaVersion()).toBe(DB_VERSION)
  })

  test('建库就自带 12 个内置分类，按 order 排序', async () => {
    const categories = await adapter.listCategories()
    expect(categories).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(categories.map((c) => c.name)[0]).toBe('餐饮')
    expect(categories.map((c) => c.order)).toEqual([...categories.map((c) => c.order)].sort((a, b) => a - b))
  })

  test('重复打开同一个库不会重复跑迁移（分类不会被写两遍）', async () => {
    await adapter.saveCategory(makeCategory({ id: 'cat-custom' }))
    const second = newAdapter()
    await second.init()
    expect(await second.listCategories()).toHaveLength(DEFAULT_CATEGORIES.length + 1)
  })
})

describe('流水的读写', () => {
  test('存进去能原样读出来（含标签数组）', async () => {
    const expense = makeExpense({ id: 'e1', amountCents: 1234, tags: ['午饭', '工作日'], note: '便当' })
    await adapter.saveExpense(expense)
    expect(await adapter.getExpense('e1')).toEqual(expense)
  })

  test('同一 id 再存是更新，不是新增', async () => {
    await adapter.saveExpense(makeExpense({ id: 'e1', amountCents: 100 }))
    await adapter.saveExpense(makeExpense({ id: 'e1', amountCents: 200 }))
    expect((await adapter.getExpense('e1'))?.amountCents).toBe(200)
    expect(await adapter.listAllExpenses()).toHaveLength(1)
  })

  test('查不到返回 undefined', async () => {
    expect(await adapter.getExpense('nope')).toBeUndefined()
  })
})

describe('查询：排序、筛选、分页', () => {
  beforeEach(async () => {
    for (let i = 1; i <= 25; i++) {
      await adapter.saveExpense(
        makeExpense({
          id: `e${i}`,
          amountCents: i * 100,
          categoryId: i % 2 === 0 ? 'cat-food' : 'cat-fun',
          spentAt: `2026-09-${String(i).padStart(2, '0')}`,
          note: i === 5 ? '特殊的备注' : '',
          attachmentIds: i === 7 ? ['a7'] : [],
        }),
      )
    }
  })

  test('按日期倒序 + 分页 + total', async () => {
    const page1 = await adapter.queryExpenses({ filters: emptyFiltersValue, offset: 0, limit: 20 })
    expect(page1.total).toBe(25)
    expect(page1.items).toHaveLength(20)
    expect(page1.hasMore).toBe(true)
    expect(page1.items[0].id).toBe('e25')

    const page2 = await adapter.queryExpenses({ filters: emptyFiltersValue, offset: 20, limit: 20 })
    expect(page2.items).toHaveLength(5)
    expect(page2.hasMore).toBe(false)
  })

  test('分类筛选', async () => {
    const page = await adapter.queryExpenses({
      filters: { ...emptyFiltersValue, categoryIds: ['cat-food'] },
      offset: 0,
      limit: 50,
    })
    expect(page.total).toBe(12)
    expect(page.items.every((e) => e.categoryId === 'cat-food')).toBe(true)
  })

  test('关键词与日期区间筛选', async () => {
    const byText = await adapter.queryExpenses({
      filters: { ...emptyFiltersValue, text: '特殊' },
      offset: 0,
      limit: 50,
    })
    expect(byText.items.map((e) => e.id)).toEqual(['e5'])

    const byRange = await adapter.queryExpenses({
      filters: { ...emptyFiltersValue, from: '2026-09-10', to: '2026-09-12' },
      offset: 0,
      limit: 50,
    })
    expect(byRange.total).toBe(3)
  })

  test('仅看有附件的', async () => {
    const page = await adapter.queryExpenses({
      filters: { ...emptyFiltersValue, onlyWithAttachments: true },
      offset: 0,
      limit: 50,
    })
    expect(page.items.map((e) => e.id)).toEqual(['e7'])
  })
})

describe('附件', () => {
  test('Blob 存进去能原样读出来，大小不变', async () => {
    await adapter.saveExpense(makeExpense({ id: 'e1', attachmentIds: ['a1'] }))
    const attachment = makeAttachment({ id: 'a1', expenseId: 'e1', sizeBytes: 4096 })
    await adapter.saveAttachment(attachment)

    const loaded = await adapter.getAttachment('a1')
    expect(loaded?.sizeBytes).toBe(4096)
    expect(loaded?.mime).toBe('image/webp')
    expect(loaded?.blob).toBeInstanceOf(Blob)
    expect(loaded?.blob.size).toBe(4096)
  })

  test('按流水 id 列出附件', async () => {
    await adapter.saveAttachment(makeAttachment({ id: 'a1', expenseId: 'e1' }))
    await adapter.saveAttachment(makeAttachment({ id: 'a2', expenseId: 'e1' }))
    await adapter.saveAttachment(makeAttachment({ id: 'a3', expenseId: 'e2' }))
    expect((await adapter.listAttachments('e1')).map((a) => a.id).sort()).toEqual(['a1', 'a2'])
  })

  test('删流水会级联删掉它的附件，不留孤儿', async () => {
    await adapter.saveExpense(makeExpense({ id: 'e1', attachmentIds: ['a1', 'a2'] }))
    await adapter.saveAttachment(makeAttachment({ id: 'a1', expenseId: 'e1' }))
    await adapter.saveAttachment(makeAttachment({ id: 'a2', expenseId: 'e1' }))
    await adapter.saveAttachment(makeAttachment({ id: 'a9', expenseId: 'e9' }))

    await adapter.deleteExpense('e1')

    expect(await adapter.getExpense('e1')).toBeUndefined()
    expect(await adapter.getAttachment('a1')).toBeUndefined()
    expect(await adapter.getAttachment('a2')).toBeUndefined()
    expect(await adapter.getAttachment('a9')).toBeDefined() // 别人的附件不受影响
  })

  test('重复插图不会把已有附件弄丢（撤销删除要能连附件一起恢复）', async () => {
    const a1 = makeAttachment({ id: 'a1', expenseId: 'e1' })
    await adapter.saveAttachment(a1)
    await adapter.deleteAttachment('a1')
    expect(await adapter.getAttachment('a1')).toBeUndefined()
    await adapter.saveAttachment(a1)
    expect(await adapter.getAttachment('a1')).toBeDefined()
  })
})

describe('设置', () => {
  test('没存过时返回默认值', async () => {
    const settings = await adapter.getSettings()
    expect(settings).toMatchObject({ currencySymbol: '¥', theme: 'strawberry', weekStart: 1, monthlyBudgetCents: 0 })
  })

  test('存了之后读出来是存的值', async () => {
    await adapter.saveSettings(makeSettings({ currencySymbol: '$', theme: 'mint', monthlyBudgetCents: 500_000 }))
    const settings = await adapter.getSettings()
    expect(settings).toMatchObject({ currencySymbol: '$', theme: 'mint', monthlyBudgetCents: 500_000 })
  })
})

describe('备份导出与导入', () => {
  test('dump 导出全部表', async () => {
    await adapter.saveExpense(makeExpense({ id: 'e1' }))
    await adapter.saveAttachment(makeAttachment({ id: 'a1', expenseId: 'e1' }))
    const dump = await adapter.dump()
    expect(dump.schemaVersion).toBe(DB_VERSION)
    expect(dump.expenses).toHaveLength(1)
    expect(dump.attachments).toHaveLength(1)
    expect(dump.categories).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(dump.settings.currencySymbol).toBe('¥')
  })

  test('merge 导入：同 id 覆盖，别的保留，坏记录计入 skipped', async () => {
    await adapter.saveExpense(makeExpense({ id: 'keep', amountCents: 100 }))
    await adapter.saveExpense(makeExpense({ id: 'dup', amountCents: 100 }))

    const result = await adapter.bulkPut(
      {
        expenses: [
          makeExpense({ id: 'dup', amountCents: 999 }),
          makeExpense({ id: 'brand-new', amountCents: 500 }),
          { id: undefined as unknown as string, amountCents: 1 } as never,
        ],
        attachments: [],
        categories: [],
        settings: { currencySymbol: '¥' } as Settings,
      },
      'merge',
    )

    expect(result.skipped).toBe(1)
    expect(await adapter.listAllExpenses()).toHaveLength(3)
    expect((await adapter.getExpense('dup'))?.amountCents).toBe(999)
    expect((await adapter.getExpense('keep'))?.amountCents).toBe(100)
  })

  test('replace 导入：先清空再写入', async () => {
    await adapter.saveExpense(makeExpense({ id: 'old-1' }))
    await adapter.saveExpense(makeExpense({ id: 'old-2' }))
    await adapter.bulkPut(
      { expenses: [makeExpense({ id: 'new-1' })], attachments: [], categories: [], settings: makeSettings() },
      'replace',
    )
    const list = await adapter.listAllExpenses()
    expect(list.map((e) => e.id)).toEqual(['new-1'])
  })

  test('导入老备份里缺字段的设置不会把默认值弄丢', async () => {
    await adapter.bulkPut(
      { expenses: [], attachments: [], categories: [], settings: { currencySymbol: '$' } as Settings },
      'merge',
    )
    const settings = await adapter.getSettings()
    expect(settings.currencySymbol).toBe('$')
    expect(settings.theme).toBe('strawberry')
    expect(settings.weekStart).toBe(1)
  })
})

describe('分类与统计', () => {
  test('统计某分类下的流水数', async () => {
    await adapter.saveExpense(makeExpense({ id: 'e1', categoryId: 'cat-food' }))
    await adapter.saveExpense(makeExpense({ id: 'e2', categoryId: 'cat-food' }))
    await adapter.saveExpense(makeExpense({ id: 'e3', categoryId: 'cat-fun' }))
    expect(await adapter.countExpensesInCategory('cat-food')).toBe(2)
    expect(await adapter.countExpensesInCategory('cat-none')).toBe(0)
  })

  test('归档分类仍可读取，但能被上层过滤掉', async () => {
    await adapter.saveCategory(makeCategory({ id: 'cat-arch', archived: true }))
    const all = await adapter.listCategories()
    expect(all.find((c) => c.id === 'cat-arch')?.archived).toBe(true)
    expect(all.filter((c) => !c.archived)).toHaveLength(DEFAULT_CATEGORIES.length)
  })
})

describe('清空数据', () => {
  test('清空流水与附件，但把内置分类补回来（不然没法继续记账）', async () => {
    await adapter.saveExpense(makeExpense({ id: 'e1' }))
    await adapter.saveAttachment(makeAttachment({ id: 'a1', expenseId: 'e1' }))
    await adapter.saveCategory(makeCategory({ id: 'cat-custom' }))

    await adapter.wipe()

    expect(await adapter.listAllExpenses()).toEqual([])
    expect(await adapter.dump()).toMatchObject({ attachments: [] })
    const categories = await adapter.listCategories()
    expect(categories).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(categories.find((c) => c.id === 'cat-custom')).toBeUndefined()
  })
})

describe('存储用量', () => {
  test('没有 navigator.storage 时返回 0 而不是抛错', async () => {
    const usage = await adapter.usage()
    expect(usage).toEqual({ usedBytes: 0, quotaBytes: 0 })
  })
})