import { afterAll, describe, expect, test } from 'vitest'
import { runSync } from './engine'
import { createMemoryRemote } from '../../test/remote'
import { closeAllAdapters, freshAdapter, newAdapter } from '../../test/idb'
import { DB_VERSION } from '../../data/migrations'
import { makeAttachment, makeExpense } from '../../test/factories'
import { TOMBSTONES_META_KEY } from '../../domain/sync'

afterAll(() => {
  closeAllAdapters()
})

/** 一次同步：设备 + 远端 */
async function sync(adapter: Awaited<ReturnType<typeof freshAdapter>>, remote: ReturnType<typeof createMemoryRemote>) {
  return runSync({ adapter, remote, schemaVersion: DB_VERSION, now: () => new Date('2026-09-17T12:00:00.000Z') })
}

describe('第一次同步', () => {
  test('云端是空的 → 把本机的东西全推上去', async () => {
    const remote = createMemoryRemote()
    const phone = await freshAdapter()
    await phone.saveExpense(makeExpense({ id: 'e1', amountCents: 1234, note: '手机上记的' }))

    const report = await sync(phone, remote)

    expect(report.ok).toBe(true)
    expect(remote.snapshot?.expenses.map((e) => e.id)).toEqual(['e1'])
    expect(remote.writeCount).toBe(1)
  })

  test('本机没变、云端也没变 → 不再产生新提交（避免同步刷空提交）', async () => {
    const remote = createMemoryRemote()
    const phone = await freshAdapter()
    await phone.saveExpense(makeExpense({ id: 'e1' }))

    await sync(phone, remote)
    const before = remote.writeCount
    const report = await sync(phone, remote)

    expect(remote.writeCount).toBe(before)
    expect(report.pushed.skipped).toBe(true)
  })
})

describe('两台设备互通（这就是领导要的效果）', () => {
  test('手机记一笔 → 电脑同步后能看到', async () => {
    const remote = createMemoryRemote()
    const phone = await freshAdapter()
    await phone.saveExpense(makeExpense({ id: 'e1', amountCents: 8880, note: '手机上记的' }))
    await sync(phone, remote)

    const computer = newAdapter()
    await computer.init()
    await sync(computer, remote)

    const onComputer = await computer.getExpense('e1')
    expect(onComputer?.amountCents).toBe(8880)
    expect(onComputer?.note).toBe('手机上记的')
  })

  test('电脑改一笔 → 手机同步后看到的是改完的', async () => {
    const remote = createMemoryRemote()
    const phone = await freshAdapter()
    await phone.saveExpense(makeExpense({ id: 'e1', amountCents: 100, updatedAt: '2026-09-17T10:00:00.000Z' }))
    await sync(phone, remote)

    const computer = newAdapter()
    await computer.init()
    await sync(computer, remote)
    // 电脑上改金额（时间更晚）
    await computer.saveExpense(makeExpense({ id: 'e1', amountCents: 999, updatedAt: '2026-09-17T11:00:00.000Z' }))
    await sync(computer, remote)
    await sync(phone, remote)

    expect((await phone.getExpense('e1'))?.amountCents).toBe(999)
  })

  test('手机删一笔 → 电脑同步后也没了（不会被电脑的旧副本推回来）', async () => {
    const remote = createMemoryRemote()
    const phone = await freshAdapter()
    await phone.saveExpense(makeExpense({ id: 'e1', updatedAt: '2026-09-17T09:00:00.000Z' }))
    await sync(phone, remote)

    const computer = newAdapter()
    await computer.init()
    await sync(computer, remote)
    expect(await computer.getExpense('e1')).toBeDefined()

    // 手机上删掉（落墓碑）再同步
    await phone.deleteExpense('e1')
    await phone.setMeta(TOMBSTONES_META_KEY, { e1: '2026-09-17T13:00:00.000Z' })
    await sync(phone, remote)

    // 电脑同步：自己的旧副本要被删掉
    await sync(computer, remote)
    expect(await computer.getExpense('e1')).toBeUndefined()
    // 云端也没有了
    expect(remote.snapshot?.expenses).toHaveLength(0)
  })

  test('两台各记各的 → 同步后两边都有两条', async () => {
    const remote = createMemoryRemote()
    const phone = await freshAdapter()
    const computer = newAdapter()
    await computer.init()

    await phone.saveExpense(makeExpense({ id: 'from-phone', spentAt: '2026-09-17' }))
    await computer.saveExpense(makeExpense({ id: 'from-computer', spentAt: '2026-09-16' }))

    await sync(phone, remote)
    await sync(computer, remote)
    await sync(phone, remote)

    expect((await phone.listAllExpenses()).map((e) => e.id).sort()).toEqual(['from-computer', 'from-phone'])
    expect((await computer.listAllExpenses()).map((e) => e.id).sort()).toEqual(['from-computer', 'from-phone'])
  })
})

describe('附件也跟着走', () => {
  test('手机上存的图片，电脑同步后能拿到一模一样的字节', async () => {
    const remote = createMemoryRemote()
    const phone = await freshAdapter()
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252])
    await phone.saveExpense(makeExpense({ id: 'e1', attachmentIds: ['a1'] }))
    await phone.saveAttachment(
      makeAttachment({ id: 'a1', expenseId: 'e1', mime: 'image/webp', sizeBytes: bytes.length, blob: new Blob([bytes], { type: 'image/webp' }) }),
    )
    await sync(phone, remote)

    expect(remote.files.has('media/a1.webp')).toBe(true)

    const computer = newAdapter()
    await computer.init()
    await sync(computer, remote)

    const attachment = await computer.getAttachment('a1')
    expect(attachment?.mime).toBe('image/webp')
    const got = new Uint8Array(await attachment!.blob.arrayBuffer())
    expect(Array.from(got)).toEqual(Array.from(bytes))
  })

  test('删掉附件后，云端文件也会被清掉', async () => {
    const remote = createMemoryRemote()
    const phone = await freshAdapter()
    const bytes = new Uint8Array([9, 9, 9])
    await phone.saveExpense(makeExpense({ id: 'e1', attachmentIds: ['a1'] }))
    await phone.saveAttachment(
      makeAttachment({ id: 'a1', expenseId: 'e1', sizeBytes: 3, blob: new Blob([bytes], { type: 'image/webp' }) }),
    )
    await sync(phone, remote)
    expect(remote.files.size).toBe(1)

    // 删掉这笔流水（连带附件），再同步
    await phone.deleteExpense('e1')
    await phone.setMeta(TOMBSTONES_META_KEY, { e1: '2026-09-17T13:00:00.000Z', a1: '2026-09-17T13:00:00.000Z' })
    await sync(phone, remote)

    expect(remote.files.size).toBe(0)
  })
})

describe('推到云端的内容不含密钥', () => {
  test('state.json 里没有 token / 仓库名这些本机配置', async () => {
    const remote = createMemoryRemote()
    const phone = await freshAdapter()
    await phone.setMeta('syncToken', 'github_pat_SUPER_SECRET_VALUE')
    const settings = await phone.getSettings()
    await phone.saveSettings({ ...settings, syncRepo: 'me/data', syncBranch: 'main', syncEnabled: true })
    await phone.saveExpense(makeExpense({ id: 'e1' }))

    await sync(phone, remote)

    const pushed = JSON.stringify(remote.snapshot)
    expect(pushed).not.toContain('SUPER_SECRET_VALUE')
    expect(pushed).not.toContain('syncToken')
    // 也不该把「哪台设备开了同步」这种本机状态同步出去
    expect(remote.snapshot?.settings).not.toHaveProperty('syncRepo')
    expect(remote.snapshot?.settings).not.toHaveProperty('syncEnabled')
    expect(remote.snapshot?.settings).not.toHaveProperty('lastSyncAt')
    // 该同步的设置还在
    expect(remote.snapshot?.settings).toHaveProperty('currencySymbol')
  })
})

describe('出错时不装死', () => {
  test('远端读失败 → 报错抛出，不会把本机数据搞坏', async () => {
    const phone = await freshAdapter()
    await phone.saveExpense(makeExpense({ id: 'e1' }))
    const brokenRemote = {
      ...createMemoryRemote(),
      async read() {
        throw new Error('GitHub 429 限流了')
      },
    }
    await expect(runSync({ adapter: phone, remote: brokenRemote, schemaVersion: DB_VERSION })).rejects.toThrow('限流')
    expect(await phone.listAllExpenses()).toHaveLength(1)
  })
})