import { afterAll, describe, expect, test } from 'vitest'
import { createBackupService } from './backup'
import { emptyFiltersValue } from '../domain/filters'
import { makeAttachment, makeExpense } from '../test/factories'
import { closeAllAdapters, freshAdapter } from '../test/idb'
import type { IndexedDbAdapter } from '../data/adapters/indexeddb'

afterAll(() => {
  closeAllAdapters()
})

async function seeded() {
  const adapter: IndexedDbAdapter = await freshAdapter()
  await adapter.saveExpense(
    makeExpense({ id: 'e1', amountCents: 1234, note: '午饭,加饮料', tags: ['工作日'], spentAt: '2026-09-17', attachmentIds: ['a1'] }),
  )
  await adapter.saveAttachment(makeAttachment({ id: 'a1', expenseId: 'e1', sizeBytes: 2048, mime: 'image/webp' }))
  return { adapter, service: createBackupService(adapter) }
}

describe('备份导出', () => {
  test('导出成 zip，里面有 manifest/data/media 三块', async () => {
    const { service } = await seeded()
    const zip = await service.exportZip(new Date('2026-09-17T12:00:00.000Z'))
    expect(zip.type).toBe('application/zip')
    expect(zip.size).toBeGreaterThan(0)

    const preview = await service.parseZip(zip)
    expect(preview.manifest.app).toBe('cute-ledger')
    expect(preview.manifest.exportedAt).toBe('2026-09-17T12:00:00.000Z')
    expect(preview.manifest.counts).toEqual({ expenses: 1, attachments: 1, categories: 12 })
    expect(preview.data.expenses[0].amountCents).toBe(1234)
    expect(preview.data.attachments[0].file).toMatch(/^media\/a1\.webp$/)
    expect(preview.blobs.get('a1')?.byteLength).toBe(2048)
  })

  test('CSV 导出带 BOM 和表头，金额按元写', async () => {
    const { service } = await seeded()
    const blob = await service.exportCsv()

    // 直接查字节：EF BB BF 就是 UTF-8 BOM（Blob.text() 会按规范把 BOM 吃掉，不能用它验）
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])

    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(csv).toContain('日期,金额,分类,备注,标签,附件数')
    expect(csv).toContain('2026-09-17,12.34,餐饮,"午饭,加饮料",工作日,1')
  })
})

describe('备份导入', () => {
  test('导出的 zip 能原样导回去：流水、附件、备注都还在', async () => {
    const source = await seeded()
    const zip = await source.service.exportZip()

    // 换一个全新的库，模拟「换手机」
    const target = await freshAdapter()
    const targetService = createBackupService(target)
    const preview = await targetService.parseZip(zip)
    const result = await targetService.importPreview(preview, 'replace')

    expect(result.expenses).toBe(1)
    expect(result.attachments).toBe(1)

    const restored = await target.getExpense('e1')
    expect(restored?.note).toBe('午饭,加饮料')
    expect(restored?.amountCents).toBe(1234)

    const attachment = await target.getAttachment('a1')
    expect(attachment?.blob.size).toBe(2048)
    expect(attachment?.mime).toBe('image/webp')
  })

  test('合并导入不会丢掉本机已有的数据', async () => {
    const source = await seeded()
    const zip = await source.service.exportZip()

    const target = await freshAdapter()
    await target.saveExpense(makeExpense({ id: 'local-1', amountCents: 999, spentAt: '2026-09-01' }))

    const targetService = createBackupService(target)
    await targetService.importPreview(await targetService.parseZip(zip), 'merge')

    const list = await target.queryExpenses({ filters: emptyFiltersValue, offset: 0, limit: 10 })
    expect(list.total).toBe(2)
    expect(list.items.map((e) => e.id).sort()).toEqual(['e1', 'local-1'])
  })

  test('不是本账本的 zip 会被明确拒绝', async () => {
    const { service } = await seeded()
    const bogus = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/zip' })
    await expect(service.parseZip(bogus)).rejects.toThrow()
  })

  test('备份里附件文件丢了也能导入，只是跳过那个附件（不写坏记录）', async () => {
    const { adapter, service } = await seeded()
    const dump = await adapter.dump()
    // 手工造一个「元数据在、media 文件不在」的备份
    const data = {
      schemaVersion: dump.schemaVersion,
      exportedAt: '2026-09-17T12:00:00.000Z',
      expenses: dump.expenses,
      attachments: [{ ...dump.attachments[0], blob: undefined, file: 'media/missing.webp' }],
      categories: dump.categories,
      settings: dump.settings,
    }
    const { zipSync, strToU8 } = await import('fflate')
    const zip = new Blob([
      zipSync({
        'manifest.json': strToU8(JSON.stringify({ app: 'cute-ledger', format: 1, schemaVersion: 1, exportedAt: 'x', counts: { expenses: 1, attachments: 1, categories: 12 } })),
        'data.json': strToU8(JSON.stringify(data)),
      }),
    ])

    const preview = await service.parseZip(zip)
    expect(preview.blobs.size).toBe(0)
    const target = await freshAdapter()
    const targetService = createBackupService(target)
    await targetService.importPreview(preview, 'replace')
    expect(await target.getExpense('e1')).toBeDefined()
    expect(await target.getAttachment('a1')).toBeUndefined()
  })
})