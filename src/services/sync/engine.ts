import type { StorageAdapter } from '../../data/ports'
import {
  TOMBSTONES_META_KEY,
  applySharedSettings,
  attachmentPath,
  mergeStates,
  pruneTombstones,
  snapshotFingerprint,
  toSharedSettings,
  type SyncSnapshot,
} from '../../domain/sync'
import type { AttachmentMeta, Id, IsoString } from '../../domain/types'
import type { RemoteStore } from './github'

export interface SyncReport {
  ok: boolean
  at: IsoString
  message: string
  pulled: { expenses: number; categories: number; attachments: number; removed: number; settings: boolean }
  pushed: { expenses: number; categories: number; attachments: number; deletedFiles: number; skipped: boolean }
}

export interface SyncDeps {
  adapter: StorageAdapter
  remote: RemoteStore
  schemaVersion: number
  now?: () => Date
}

async function readTombstones(adapter: StorageAdapter): Promise<Record<Id, IsoString>> {
  return (await adapter.getMeta<Record<Id, IsoString>>(TOMBSTONES_META_KEY)) ?? {}
}

async function buildLocalSnapshot(adapter: StorageAdapter, schemaVersion: number, now: IsoString): Promise<SyncSnapshot> {
  const [expenses, categories, attachments, settings, tombstones] = await Promise.all([
    adapter.listAllExpenses(),
    adapter.listCategories(),
    adapter.listAttachmentMeta(),
    adapter.getSettings(),
    readTombstones(adapter),
  ])
  return {
    schemaVersion,
    generatedAt: now,
    expenses,
    categories,
    attachments,
    settings: toSharedSettings(settings),
    tombstones,
  }
}

/**
 * 跑一次同步。方向是「先拉后推」：
 * 1. 读远端快照 → 2. 本地远端合并（最后写入者赢 + 墓碑）→ 3. 把该改的写进本机
 * 4. 缺的附件下下来 → 5. 把合并后的完整快照 + 新附件推上去 → 6. 记下这次同步时间
 */
export async function runSync(deps: SyncDeps): Promise<SyncReport> {
  const { adapter, remote, schemaVersion } = deps
  const now = (deps.now ?? (() => new Date()))().toISOString()

  const local = await buildLocalSnapshot(adapter, schemaVersion, now)
  const remoteRead = await remote.read()
  const merge = mergeStates(local, remoteRead.snapshot, schemaVersion, now)

  const pulled = { expenses: 0, categories: 0, attachments: 0, removed: 0, settings: false }

  for (const expense of merge.applied.expenses) {
    await adapter.saveExpense(expense)
    pulled.expenses += 1
  }
  for (const category of merge.applied.categories) {
    await adapter.saveCategory(category)
    pulled.categories += 1
  }
  for (const id of merge.applied.removedExpenseIds) {
    await adapter.deleteExpense(id)
    pulled.removed += 1
  }
  for (const id of merge.applied.removedAttachmentIds) {
    await adapter.deleteAttachment(id)
    pulled.removed += 1
  }
  if (merge.applied.settings) {
    // 只覆盖共享字段，本机的 syncRepo / lastSyncAt 这些不能被远端改掉
    const current = await adapter.getSettings()
    await adapter.saveSettings(applySharedSettings(current, merge.applied.settings))
    pulled.settings = true
  }

  // 先下二进制，再落元数据：反过来的话，界面上会出现「有记录但图片打不开」
  const localAttachmentIds = new Set(local.attachments.map((a) => a.id))
  const remoteById = new Map(merge.merged.attachments.map((a) => [a.id, a]))
  for (const id of merge.downloadAttachmentIds) {
    const meta = remoteById.get(id)
    if (!meta) continue
    try {
      const path = remoteRead.files.get(id) ?? attachmentPath(id, meta.mime)
      const bytes = await remote.readFile(path)
      await adapter.saveAttachment({ ...meta, blob: new Blob([new Uint8Array(bytes)], { type: meta.mime }) })
      pulled.attachments += 1
    } catch {
      // 单个附件下载失败不影响整次同步：元数据先不落库，下次同步再试
      localAttachmentIds.add(id)
    }
  }
  for (const meta of merge.applied.attachments) {
    if (localAttachmentIds.has(meta.id)) continue
    await adapter.saveAttachment({ ...meta, blob: new Blob([], { type: meta.mime }) })
  }

  // 远端文件里已经没有对应记录的，删掉
  const mergedIds = new Set(merge.merged.attachments.map((a) => a.id))
  const deletes: string[] = []
  for (const [id, path] of remoteRead.files) {
    if (!mergedIds.has(id)) deletes.push(path)
  }

  const uploads: Array<{ path: string; data: Uint8Array }> = []
  for (const id of merge.uploadAttachmentIds) {
    const attachment = await adapter.getAttachment(id)
    if (!attachment || attachment.sizeBytes === 0) continue
    uploads.push({
      path: attachmentPath(id, attachment.mime),
      data: new Uint8Array(await attachment.blob.arrayBuffer()),
    })
  }

  const merged = { ...merge.merged, tombstones: pruneTombstones(merge.merged.tombstones, now) }
  const remoteFingerprint = remoteRead.snapshot ? snapshotFingerprint(remoteRead.snapshot) : null
  const mergedFingerprint = snapshotFingerprint(merged)
  const nothingToPush = remoteFingerprint === mergedFingerprint && uploads.length === 0 && deletes.length === 0

  if (!nothingToPush) {
    await remote.write({
      snapshot: merged,
      uploads,
      deletes,
      message: `同步：${merged.expenses.length} 笔流水、${merged.attachments.length} 个附件`,
    })
  }

  await adapter.setMeta(TOMBSTONES_META_KEY, merged.tombstones)
  const settings = await adapter.getSettings()
  await adapter.saveSettings({ ...settings, lastSyncAt: now })

  const summary = [
    remoteRead.warning ?? '',
    `拉取 ${pulled.expenses} 笔/分类 ${pulled.categories}`,
    pulled.attachments > 0 ? `下载 ${pulled.attachments} 个附件` : '',
    pulled.removed > 0 ? `删除 ${pulled.removed} 条` : '',
    nothingToPush
      ? '没有需要上传的'
      : `上传 ${uploads.length} 个附件${deletes.length > 0 ? `、删远端 ${deletes.length} 个文件` : ''}`,
  ]
    .filter(Boolean)
    .join('，')

  return {
    ok: true,
    at: now,
    message: summary,
    pulled,
    pushed: {
      expenses: merged.expenses.length,
      categories: merged.categories.length,
      attachments: uploads.length,
      deletedFiles: deletes.length,
      skipped: nothingToPush,
    },
  }
}

export type { AttachmentMeta }