import { afterAll, describe, expect, test } from 'vitest'
import { runSync } from './engine'
import { createMemoryRemote } from '../../test/remote'
import { closeAllDevices, openDevice, resetAllDevices } from '../../test/idb'
import type { IndexedDbAdapter } from '../../data/adapters/indexeddb'
import { DB_VERSION } from '../../data/migrations'
import { makeAttachment, makeExpense } from '../../test/factories'
import { TOMBSTONES_META_KEY } from '../../domain/sync'

afterAll(() => {
  closeAllDevices()
})

type Remote = ReturnType<typeof createMemoryRemote>
const NOW = () => new Date('2026-09-17T12:00:00.000Z')

async function sync(device: IndexedDbAdapter, remote: Remote) {
  return runSync({ adapter: device, remote, schemaVersion: DB_VERSION, now: NOW })
}

/**
 * 两台**真正独立**的设备：两个不同的 IndexedDB 库。
 * （踩过的坑：同一个库开两个适配器实例是「同一台设备」，那样测跨设备同步永远是假绿灯。）
 */
async function twoDevices() {
  await resetAllDevices()
  const phone = await openDevice('phone')
  const computer = await openDevice('computer')
  return { phone, computer }
}

async function oneDevice() {
  await resetAllDevices()
  return openDevice('phone')
}

async function imageOn(device: IndexedDbAdapter, id: string, expenseId: string, size = 5000) {
  const bytes = new Uint8Array(size).map((_, index) => index % 251)
  await device.saveAttachment(
    makeAttachment({
      id,
      expenseId,
      mime: 'image/webp',
      sizeBytes: bytes.length,
      blob: new Blob([bytes], { type: 'image/webp' }),
    }),
  )
  return bytes
}

describe('第一次同步', () => {
  test('云端是空的 → 把本机的东西全推上去', async () => {
    const remote = createMemoryRemote()
    const phone = await oneDevice()
    await phone.saveExpense(makeExpense({ id: 'e1', amountCents: 1234, note: '手机上记的' }))

    const report = await sync(phone, remote)

    expect(report.ok).toBe(true)
    expect(remote.snapshot?.expenses.map((e) => e.id)).toEqual(['e1'])
    expect(remote.writeCount).toBe(1)
  })

  test('本机没变、云端也没变 → 不再产生新提交（避免同步刷空提交）', async () => {
    const remote = createMemoryRemote()
    const phone = await oneDevice()
    await phone.saveExpense(makeExpense({ id: 'e1' }))

    await sync(phone, remote)
    const before = remote.writeCount
    const report = await sync(phone, remote)

    expect(remote.writeCount).toBe(before)
    expect(report.pushed.skipped).toBe(true)
  })
})

describe('两台设备互通（领导要的效果）', () => {
  test('手机记一笔 → 电脑同步后能看到', async () => {
    const remote = createMemoryRemote()
    const { phone, computer } = await twoDevices()

    await phone.saveExpense(makeExpense({ id: 'e1', amountCents: 8880, note: '手机上记的' }))
    await sync(phone, remote)
    // 同步之前电脑确实什么都没有
    expect(await computer.listAllExpenses()).toHaveLength(0)

    const report = await sync(computer, remote)

    expect(report.pulled.expenses).toBe(1)
    const onComputer = await computer.getExpense('e1')
    expect(onComputer?.amountCents).toBe(8880)
    expect(onComputer?.note).toBe('手机上记的')
  })

  test('电脑改一笔 → 手机同步后看到的是改完的', async () => {
    const remote = createMemoryRemote()
    const { phone, computer } = await twoDevices()

    await phone.saveExpense(makeExpense({ id: 'e1', amountCents: 100, updatedAt: '2026-09-17T10:00:00.000Z' }))
    await sync(phone, remote)
    await sync(computer, remote)

    await computer.saveExpense(makeExpense({ id: 'e1', amountCents: 999, updatedAt: '2026-09-17T11:00:00.000Z' }))
    await sync(computer, remote)
    await sync(phone, remote)

    expect((await phone.getExpense('e1'))?.amountCents).toBe(999)
  })

  test('手机删一笔 → 电脑同步后也没了（不会被电脑的旧副本推回来）', async () => {
    const remote = createMemoryRemote()
    const { phone, computer } = await twoDevices()

    await phone.saveExpense(makeExpense({ id: 'e1', updatedAt: '2026-09-17T09:00:00.000Z' }))
    await sync(phone, remote)
    await sync(computer, remote)
    expect(await computer.getExpense('e1')).toBeDefined()

    await phone.deleteExpense('e1')
    await phone.setMeta(TOMBSTONES_META_KEY, { e1: '2026-09-17T13:00:00.000Z' })
    await sync(phone, remote)

    await sync(computer, remote)
    expect(await computer.getExpense('e1')).toBeUndefined()
    expect(remote.snapshot?.expenses).toHaveLength(0)
  })

  test('两台各记各的 → 同步后两边都有两条', async () => {
    const remote = createMemoryRemote()
    const { phone, computer } = await twoDevices()

    await phone.saveExpense(makeExpense({ id: 'from-phone', spentAt: '2026-09-17' }))
    await computer.saveExpense(makeExpense({ id: 'from-computer', spentAt: '2026-09-16' }))

    await sync(phone, remote)
    await sync(computer, remote)
    await sync(phone, remote)

    expect((await phone.listAllExpenses()).map((e) => e.id).sort()).toEqual(['from-computer', 'from-phone'])
    expect((await computer.listAllExpenses()).map((e) => e.id).sort()).toEqual(['from-computer', 'from-phone'])
  })
})

describe('附件（图片视频）跟着走', () => {
  test('手机的图片，电脑同步后字节一模一样（不是空壳）', async () => {
    const remote = createMemoryRemote()
    const { phone, computer } = await twoDevices()

    await phone.saveExpense(makeExpense({ id: 'e1', attachmentIds: ['a1'] }))
    const bytes = await imageOn(phone, 'a1', 'e1', 5000)
    await sync(phone, remote)
    expect(remote.files.has('media/a1.webp')).toBe(true)

    await sync(computer, remote)

    const attachment = await computer.getAttachment('a1')
    expect(attachment).toBeDefined()
    const got = new Uint8Array(await attachment!.blob.arrayBuffer())
    // 这条是重点：以前只断言「有这条记录」，图片其实是 0 字节也照样过
    expect(got.length, '图片字节数不能是 0').toBeGreaterThan(0)
    expect(Array.from(got)).toEqual(Array.from(bytes))
  })

  test('1MB 的附件也能原样传过去', async () => {
    const remote = createMemoryRemote()
    const { phone, computer } = await twoDevices()

    await phone.saveExpense(makeExpense({ id: 'e1', attachmentIds: ['big'] }))
    const bytes = await imageOn(phone, 'big', 'e1', 1_048_576)
    await sync(phone, remote)
    await sync(computer, remote)

    const attachment = await computer.getAttachment('big')
    const got = new Uint8Array(await attachment!.blob.arrayBuffer())
    expect(got.length).toBe(bytes.length)
    expect(got[1000]).toBe(bytes[1000])
    expect(got[bytes.length - 1]).toBe(bytes[bytes.length - 1])
  })

  test('多个附件一起同步，每一个都要有内容', async () => {
    const remote = createMemoryRemote()
    const { phone, computer } = await twoDevices()

    await phone.saveExpense(makeExpense({ id: 'e1', attachmentIds: ['a1', 'a2', 'a3'] }))
    await imageOn(phone, 'a1', 'e1', 1000)
    await imageOn(phone, 'a2', 'e1', 2000)
    await imageOn(phone, 'a3', 'e1', 3000)
    await sync(phone, remote)
    await sync(computer, remote)

    for (const [id, size] of [
      ['a1', 1000],
      ['a2', 2000],
      ['a3', 3000],
    ] as const) {
      const attachment = await computer.getAttachment(id)
      const got = new Uint8Array(await attachment!.blob.arrayBuffer())
      expect(got.length, `${id} 的字节数不对`).toBe(size)
    }
  })

  test('电脑侧的附件元数据（尺寸、大小）也要跟着过来', async () => {
    const remote = createMemoryRemote()
    const { phone, computer } = await twoDevices()

    await phone.saveExpense(makeExpense({ id: 'e1', attachmentIds: ['a1'] }))
    await phone.saveAttachment(
      makeAttachment({
        id: 'a1',
        expenseId: 'e1',
        mime: 'image/webp',
        sizeBytes: 1234,
        width: 1600,
        height: 1200,
        blob: new Blob([new Uint8Array(1234)], { type: 'image/webp' }),
      }),
    )
    await sync(phone, remote)
    await sync(computer, remote)

    const attachment = await computer.getAttachment('a1')
    expect(attachment?.width).toBe(1600)
    expect(attachment?.height).toBe(1200)
    expect(attachment?.sizeBytes).toBe(1234)
  })

  test('删掉附件后，云端文件也会被清掉', async () => {
    const remote = createMemoryRemote()
    const { phone, computer } = await twoDevices()

    await phone.saveExpense(makeExpense({ id: 'e1', attachmentIds: ['a1'] }))
    await imageOn(phone, 'a1', 'e1')
    await sync(phone, remote)
    expect(remote.files.size).toBe(1)
    await sync(computer, remote)
    expect(await computer.getAttachment('a1')).toBeDefined()

    await phone.deleteExpense('e1')
    await phone.setMeta(TOMBSTONES_META_KEY, { e1: '2026-09-17T13:00:00.000Z', a1: '2026-09-17T13:00:00.000Z' })
    await sync(phone, remote)

    expect(remote.files.size).toBe(0)
    await sync(computer, remote)
    expect(await computer.getAttachment('a1')).toBeUndefined()
  })

  test('本机留下过 0 字节空壳的附件，下次同步会补下来（自愈）', async () => {
    const remote = createMemoryRemote()
    const { phone, computer } = await twoDevices()

    await phone.saveExpense(makeExpense({ id: 'e1', attachmentIds: ['a1'] }))
    const bytes = await imageOn(phone, 'a1', 'e1', 4000)
    await sync(phone, remote)

    // 手工把电脑那边做成「有元数据、二进制为空」的坏状态（旧版本同步就会留下这种）
    const meta = (await remote.read()).snapshot!.attachments[0]
    await computer.saveAttachment({ ...meta, blob: new Blob([], { type: 'image/webp' }) })
    expect((await computer.getAttachment('a1'))!.blob.size).toBe(0)

    await sync(computer, remote)

    const repaired = await computer.getAttachment('a1')
    expect(new Uint8Array(await repaired!.blob.arrayBuffer()).length).toBe(bytes.length)
  })

  test('云端文件被手工删了，本机已有的副本不能被清空', async () => {
    const remote = createMemoryRemote()
    const { phone, computer } = await twoDevices()

    await phone.saveExpense(makeExpense({ id: 'e1', attachmentIds: ['a1'] }))
    await imageOn(phone, 'a1', 'e1')
    await sync(phone, remote)
    await sync(computer, remote)
    const before = await computer.getAttachment('a1')

    remote.files.clear()
    await sync(computer, remote)

    const after = await computer.getAttachment('a1')
    expect(new Uint8Array(await after!.blob.arrayBuffer()).length).toBe(
      new Uint8Array(await before!.blob.arrayBuffer()).length,
    )
  })
})

describe('推到云端的内容不含密钥', () => {
  test('state.json 里没有 token / 仓库名这些本机配置', async () => {
    const remote = createMemoryRemote()
    const phone = await oneDevice()
    await phone.setMeta('syncToken', 'github_pat_SUPER_SECRET_VALUE')
    const settings = await phone.getSettings()
    await phone.saveSettings({ ...settings, syncRepo: 'me/data', syncBranch: 'main', syncEnabled: true })
    await phone.saveExpense(makeExpense({ id: 'e1' }))

    await sync(phone, remote)

    const pushed = JSON.stringify(remote.snapshot)
    expect(pushed).not.toContain('SUPER_SECRET_VALUE')
    expect(pushed).not.toContain('syncToken')
    expect(remote.snapshot?.settings).not.toHaveProperty('syncRepo')
    expect(remote.snapshot?.settings).not.toHaveProperty('syncEnabled')
    expect(remote.snapshot?.settings).not.toHaveProperty('lastSyncAt')
    expect(remote.snapshot?.settings).toHaveProperty('currencySymbol')
  })
})

describe('出错时不装死', () => {
  test('远端读失败 → 报错抛出，不会把本机数据搞坏', async () => {
    const phone = await oneDevice()
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