import { describe, expect, test } from 'vitest'
import {
  attachmentIdFromPath,
  attachmentPath,
  mergeStates,
  mergeTombstones,
  pruneTombstones,
  snapshotFingerprint,
  type SyncSnapshot,
} from './sync'
import { makeAttachment, makeCategory, makeExpense, makeSettings } from '../test/factories'
import type { AttachmentMeta } from './types'

const NOW = '2026-09-17T12:00:00.000Z'
const SCHEMA = 2

function attachmentMeta(over: Partial<AttachmentMeta> = {}): AttachmentMeta {
  const { blob: _blob, ...meta } = makeAttachment(over as never)
  return { ...meta, ...over }
}

function snapshot(over: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    schemaVersion: SCHEMA,
    generatedAt: NOW,
    expenses: [],
    categories: [],
    attachments: [],
    settings: makeSettings(),
    tombstones: {},
    ...over,
  }
}

describe('合并：一条记录两边都有', () => {
  test('远端更新就用远端', () => {
    const local = makeExpense({ id: 'e1', amountCents: 100, updatedAt: '2026-09-17T10:00:00.000Z' })
    const remote = makeExpense({ id: 'e1', amountCents: 200, updatedAt: '2026-09-17T11:00:00.000Z' })
    const result = mergeStates(snapshot({ expenses: [local] }), snapshot({ expenses: [remote] }), SCHEMA, NOW)

    expect(result.merged.expenses).toHaveLength(1)
    expect(result.merged.expenses[0].amountCents).toBe(200)
    expect(result.applied.expenses.map((e) => e.id)).toEqual(['e1'])
  })

  test('本机更新就留本机，且不算作要拉取', () => {
    const local = makeExpense({ id: 'e1', amountCents: 100, updatedAt: '2026-09-17T11:00:00.000Z' })
    const remote = makeExpense({ id: 'e1', amountCents: 200, updatedAt: '2026-09-17T10:00:00.000Z' })
    const result = mergeStates(snapshot({ expenses: [local] }), snapshot({ expenses: [remote] }), SCHEMA, NOW)

    expect(result.merged.expenses[0].amountCents).toBe(100)
    expect(result.applied.expenses).toHaveLength(0)
  })

  test('时间戳一样时留本机（结果稳定）', () => {
    const at = '2026-09-17T10:00:00.000Z'
    const local = makeExpense({ id: 'e1', note: '本机', updatedAt: at })
    const remote = makeExpense({ id: 'e1', note: '远端', updatedAt: at })
    const result = mergeStates(snapshot({ expenses: [local] }), snapshot({ expenses: [remote] }), SCHEMA, NOW)
    expect(result.merged.expenses[0].note).toBe('本机')
  })

  test('一边有一边没有 → 求并集', () => {
    const a = makeExpense({ id: 'only-local' })
    const b = makeExpense({ id: 'only-remote' })
    const result = mergeStates(snapshot({ expenses: [a] }), snapshot({ expenses: [b] }), SCHEMA, NOW)
    expect(result.merged.expenses.map((e) => e.id).sort()).toEqual(['only-local', 'only-remote'])
    expect(result.applied.expenses.map((e) => e.id)).toEqual(['only-remote'])
  })

  test('远端是空的（第一次同步）→ 全推上去', () => {
    const local = snapshot({ expenses: [makeExpense({ id: 'e1' })], attachments: [attachmentMeta({ id: 'a1' })] })
    const result = mergeStates(local, null, SCHEMA, NOW)
    expect(result.merged.expenses).toHaveLength(1)
    expect(result.uploadAttachmentIds).toEqual(['a1'])
    expect(result.downloadAttachmentIds).toEqual([])
  })
})

describe('合并：删除靠墓碑传播', () => {
  test('A 删了 → B 的旧副本必须也被删掉，不能被推回来', () => {
    const stale = makeExpense({ id: 'e1', updatedAt: '2026-09-17T09:00:00.000Z' })
    const local = snapshot({ expenses: [stale] })
    const remote = snapshot({ tombstones: { e1: '2026-09-17T10:00:00.000Z' } })

    const result = mergeStates(local, remote, SCHEMA, NOW)
    expect(result.merged.expenses).toHaveLength(0)
    expect(result.applied.removedExpenseIds).toEqual(['e1'])
    expect(result.stats.deleted).toBe(1)
  })

  test('删了之后又编辑过（时间更晚）→ 以编辑为准，活下来', () => {
    const edited = makeExpense({ id: 'e1', updatedAt: '2026-09-17T11:00:00.000Z' })
    const remote = snapshot({ tombstones: { e1: '2026-09-17T10:00:00.000Z' } })
    const result = mergeStates(snapshot({ expenses: [edited] }), remote, SCHEMA, NOW)
    expect(result.merged.expenses.map((e) => e.id)).toEqual(['e1'])
    expect(result.applied.removedExpenseIds).toEqual([])
    // 墓碑还留着（时间没被清掉），但这条记录能活下来
    expect(result.merged.tombstones.e1).toBe('2026-09-17T10:00:00.000Z')
  })

  test('墓碑取并集，同 id 取更晚的删除时间', () => {
    const merged = mergeTombstones({ a: '2026-01-01T00:00:00.000Z', b: '2026-01-02T00:00:00.000Z' }, {
      a: '2026-03-01T00:00:00.000Z',
      c: '2026-02-01T00:00:00.000Z',
    })
    expect(merged).toEqual({
      a: '2026-03-01T00:00:00.000Z',
      b: '2026-01-02T00:00:00.000Z',
      c: '2026-02-01T00:00:00.000Z',
    })
  })

  test('清空数据后云端记录不会复活（清空会立墓碑，合并结果为空）', () => {
    const remote = snapshot({ expenses: [makeExpense({ id: 'e1' }), makeExpense({ id: 'e2' })] })
    // 本机刚「清空全部数据」：记录已经没了，只剩墓碑
    const local = snapshot({ tombstones: { e1: NOW, e2: NOW } })
    const result = mergeStates(local, remote, SCHEMA, NOW)

    // 关键断言：不复活。本机本来就没有这两条，所以没有「要删掉」的（removedExpenseIds 为空是对的）
    expect(result.merged.expenses).toHaveLength(0)
    expect(result.applied.removedExpenseIds).toEqual([])
    // 合并结果和远端内容不同 → 引擎会把「空」推上去，云端的记录也就真的没了
    expect(snapshotFingerprint(result.merged)).not.toBe(snapshotFingerprint(remote))
  })

  test('本机还有记录时，墓碑会让它被删掉并报出来', () => {
    const remote = snapshot({ expenses: [makeExpense({ id: 'e1' }), makeExpense({ id: 'e2' })] })
    const local = snapshot({
      expenses: [makeExpense({ id: 'e1' }), makeExpense({ id: 'e2' })],
      tombstones: { e1: NOW, e2: NOW },
    })
    const result = mergeStates(local, remote, SCHEMA, NOW)
    expect(result.merged.expenses).toHaveLength(0)
    expect(result.applied.removedExpenseIds.sort()).toEqual(['e1', 'e2'])
  })

  test('超过 90 天的墓碑会被清掉', () => {
    const tombstones = {
      fresh: '2026-09-01T00:00:00.000Z',
      old: '2026-01-01T00:00:00.000Z',
    }
    expect(Object.keys(pruneTombstones(tombstones, NOW))).toEqual(['fresh'])
  })
})

describe('合并：分类与设置', () => {
  test('分类按 updatedAt 合并', () => {
    const local = makeCategory({ id: 'c1', name: '本机名', updatedAt: '2026-09-17T09:00:00.000Z' })
    const remote = makeCategory({ id: 'c1', name: '远端名', updatedAt: '2026-09-17T10:00:00.000Z' })
    const result = mergeStates(snapshot({ categories: [local] }), snapshot({ categories: [remote] }), SCHEMA, NOW)
    expect(result.merged.categories[0].name).toBe('远端名')
  })

  test('设置按 updatedAt 取新的', () => {
    const local = makeSettings({ currencySymbol: '¥', updatedAt: '2026-09-17T10:00:00.000Z' })
    const remote = makeSettings({ currencySymbol: '$', updatedAt: '2026-09-17T11:00:00.000Z' })
    const result = mergeStates(snapshot({ settings: local }), snapshot({ settings: remote }), SCHEMA, NOW)
    expect(result.merged.settings.currencySymbol).toBe('$')
    expect(result.applied.settings?.currencySymbol).toBe('$')
  })

  test('本机设置更新时不会被远端盖掉', () => {
    const local = makeSettings({ currencySymbol: '¥', updatedAt: '2026-09-17T11:00:00.000Z' })
    const remote = makeSettings({ currencySymbol: '$', updatedAt: '2026-09-17T10:00:00.000Z' })
    const result = mergeStates(snapshot({ settings: local }), snapshot({ settings: remote }), SCHEMA, NOW)
    expect(result.merged.settings.currencySymbol).toBe('¥')
    expect(result.applied.settings).toBeNull()
  })
})

describe('合并：附件', () => {
  test('只有本机有的要上传，只有远端有的要下载', () => {
    const local = snapshot({ attachments: [attachmentMeta({ id: 'a-local' })] })
    const remote = snapshot({ attachments: [attachmentMeta({ id: 'a-remote' })] })
    const result = mergeStates(local, remote, SCHEMA, NOW)
    expect(result.uploadAttachmentIds).toEqual(['a-local'])
    expect(result.downloadAttachmentIds).toEqual(['a-remote'])
    expect(result.merged.attachments.map((a) => a.id).sort()).toEqual(['a-local', 'a-remote'])
  })

  test('两边都有的附件既不传也不下', () => {
    const meta = attachmentMeta({ id: 'a1' })
    const result = mergeStates(snapshot({ attachments: [meta] }), snapshot({ attachments: [meta] }), SCHEMA, NOW)
    expect(result.uploadAttachmentIds).toEqual([])
    expect(result.downloadAttachmentIds).toEqual([])
  })

  test('被墓碑删掉的附件要从本机清掉', () => {
    const meta = attachmentMeta({ id: 'a1', createdAt: '2026-09-17T09:00:00.000Z' })
    const remote = snapshot({ attachments: [meta], tombstones: { a1: '2026-09-17T10:00:00.000Z' } })
    const local = snapshot({ attachments: [meta] })
    const result = mergeStates(local, remote, SCHEMA, NOW)
    expect(result.merged.attachments).toHaveLength(0)
    expect(result.applied.removedAttachmentIds).toEqual(['a1'])
  })
})

describe('文件名与指纹', () => {
  test('附件路径按 mime 推后缀', () => {
    expect(attachmentPath('abc', 'image/webp')).toBe('media/abc.webp')
    expect(attachmentPath('abc', 'video/quicktime')).toBe('media/abc.mov')
    expect(attachmentPath('abc', 'application/pdf')).toBe('media/abc.bin')
  })

  test('从路径反推 id', () => {
    expect(attachmentIdFromPath('media/9f3a.webp')).toBe('9f3a')
    expect(attachmentIdFromPath('state.json')).toBeNull()
  })

  test('指纹忽略顺序和 generatedAt，内容一样就一样', () => {
    const a = makeExpense({ id: 'e1' })
    const b = makeExpense({ id: 'e2' })
    const s1 = snapshot({ expenses: [a, b], generatedAt: '2026-09-17T10:00:00.000Z' })
    const s2 = snapshot({ expenses: [b, a], generatedAt: '2026-09-17T18:00:00.000Z' })
    expect(snapshotFingerprint(s1)).toBe(snapshotFingerprint(s2))
  })

  test('内容变了指纹就变', () => {
    const s1 = snapshot({ expenses: [makeExpense({ id: 'e1', amountCents: 100 })] })
    const s2 = snapshot({ expenses: [makeExpense({ id: 'e1', amountCents: 200 })] })
    expect(snapshotFingerprint(s1)).not.toBe(snapshotFingerprint(s2))
  })
})