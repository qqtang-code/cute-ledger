import { strFromU8, strToU8, unzip, zip } from 'fflate'
import { expensesToCsv } from '../domain/csv'
import { extensionForMime, mimeForExtension } from '../domain/media'
import type { Attachment, Category, Expense, Settings } from '../domain/types'
import type { DataDump, ImportResult, StorageAdapter } from '../data/ports'

export const BACKUP_APP = 'cute-ledger'
export const BACKUP_FORMAT = 1

export interface BackupManifest {
  app: typeof BACKUP_APP
  format: number
  schemaVersion: number
  exportedAt: string
  counts: { expenses: number; attachments: number; categories: number }
}

/** data.json 里附件只存元数据，二进制单独放在 media/ 下 */
export interface BackupData {
  schemaVersion: number
  exportedAt: string
  expenses: Expense[]
  attachments: Array<Omit<Attachment, 'blob'> & { file: string }>
  categories: Category[]
  settings: Settings
}

export interface BackupPreview {
  manifest: BackupManifest
  data: BackupData
  /** 解出来的附件二进制，导入时才用得上 */
  blobs: Map<string, Uint8Array>
}

export function attachmentFileName(attachment: Pick<Attachment, 'id' | 'mime'>): string {
  return `media/${attachment.id}.${extensionForMime(attachment.mime)}`
}

async function arrayBufferOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data)))
  })
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, files) => (error ? reject(error) : resolve(files)))
  })
}

export interface BackupService {
  exportZip(now?: Date): Promise<Blob>
  exportCsv(): Promise<Blob>
  parseZip(file: Blob): Promise<BackupPreview>
  importPreview(preview: BackupPreview, mode: 'merge' | 'replace'): Promise<ImportResult>
}

export function createBackupService(adapter: StorageAdapter): BackupService {
  return {
    /** 导出：data.json + media/ + manifest.json 打成一个 zip */
    async exportZip(now = new Date()) {
      const dump = await adapter.dump()
      const files: Record<string, Uint8Array> = {}
      const attachments: BackupData['attachments'] = []

      for (const attachment of dump.attachments) {
        const file = attachmentFileName(attachment)
        files[file] = await arrayBufferOf(attachment.blob)
        const { blob: _blob, ...meta } = attachment
        attachments.push({ ...meta, file })
      }

      const manifest: BackupManifest = {
        app: BACKUP_APP,
        format: BACKUP_FORMAT,
        schemaVersion: dump.schemaVersion,
        exportedAt: now.toISOString(),
        counts: {
          expenses: dump.expenses.length,
          attachments: attachments.length,
          categories: dump.categories.length,
        },
      }
      const data: BackupData = {
        schemaVersion: dump.schemaVersion,
        exportedAt: manifest.exportedAt,
        expenses: dump.expenses,
        attachments,
        categories: dump.categories,
        settings: dump.settings,
      }

      files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
      files['data.json'] = strToU8(JSON.stringify(data, null, 2))

      const zipped = await zipAsync(files)
      // 复制一份到普通 ArrayBuffer，避免 TS 把 SharedArrayBuffer 也算进来
      return new Blob([new Uint8Array(zipped)], { type: 'application/zip' })
    },

    async exportCsv() {
      const dump = await adapter.dump()
      const csv = expensesToCsv(dump.expenses, dump.categories)
      // 带 BOM，Excel 打开不乱码
      return new Blob([csv], { type: 'text/csv;charset=utf-8' })
    },

    async parseZip(file) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const files = await unzipAsync(bytes)

      const manifestRaw = files['manifest.json']
      const dataRaw = files['data.json']
      if (!manifestRaw || !dataRaw) {
        throw new Error('这不是本账本导出的备份文件（缺少 manifest.json 或 data.json）')
      }

      const manifest = JSON.parse(strFromU8(manifestRaw)) as BackupManifest
      if (manifest.app !== BACKUP_APP) throw new Error('这个备份不是「可爱记账本」导出的')

      const data = JSON.parse(strFromU8(dataRaw)) as BackupData
      const blobs = new Map<string, Uint8Array>()
      for (const attachment of data.attachments) {
        const bytesForFile = files[attachment.file]
        if (bytesForFile) blobs.set(attachment.id, bytesForFile)
      }

      return { manifest, data, blobs }
    },

    /** 导入：把元数据 + 二进制拼回完整记录再写库 */
    async importPreview(preview, mode) {
      const attachments: Attachment[] = []
      for (const meta of preview.data.attachments) {
        const bytes = preview.blobs.get(meta.id)
        if (!bytes) continue // 备份里缺了这个附件就跳过，不写入坏记录
        const { file: _file, ...rest } = meta
        attachments.push({
          ...rest,
          blob: new Blob([new Uint8Array(bytes)], { type: rest.mime || mimeForExtension(meta.file.split('.').pop() ?? '') }),
        })
      }

      return adapter.bulkPut(
        {
          expenses: preview.data.expenses ?? [],
          attachments,
          categories: preview.data.categories ?? [],
          settings: preview.data.settings,
        },
        mode,
      )
    },
  }
}

export type { DataDump }