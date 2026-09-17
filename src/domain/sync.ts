import type { AttachmentMeta, Category, Expense, Id, IsoString, Settings } from './types'

/**
 * 多设备同步的合并规则（纯函数，零依赖，好测）。
 *
 * 三条规矩：
 * 1. 同一条记录两边都有 → 谁的 updatedAt 新听谁的（最后写入者赢）。
 * 2. 删除留「墓碑」（id + 删除时间）。有墓碑时：记录的 updatedAt 比墓碑新 = 删后又编辑过 → 留下；
 *    否则就真的删掉。这样 A 删掉的记录不会被 B 的旧副本复活。
 * 3. 附件二进制是不可变的（改了就是新 id），所以只按 id 求并集，不比较时间。
 */

/** 墓碑在本地 meta 里的键名（services 与 sync 引擎共用） */
export const TOMBSTONES_META_KEY = 'syncTombstones'

/**
 * 设置里「跨设备共享」的那部分。
 * 刻意不含 lastSyncAt / syncRepo / syncEnabled / lastBackupAt 这些「每台设备自己的」字段——
 * 否则每次同步都会因为本机簿记字段变了而多产生一个空提交。
 */
export type SharedSettings = Pick<
  Settings,
  'currencySymbol' | 'theme' | 'mode' | 'weekStart' | 'monthlyBudgetCents' | 'updatedAt'
>

export function toSharedSettings(settings: Settings): SharedSettings {
  return {
    currencySymbol: settings.currencySymbol,
    theme: settings.theme,
    mode: settings.mode,
    weekStart: settings.weekStart,
    monthlyBudgetCents: settings.monthlyBudgetCents,
    updatedAt: settings.updatedAt,
  }
}

export function applySharedSettings(local: Settings, shared: SharedSettings): Settings {
  return { ...local, ...shared }
}

export interface SyncSnapshot {
  schemaVersion: number
  /** 这份快照是什么时候生成的（排查问题用） */
  generatedAt: IsoString
  expenses: Expense[]
  categories: Category[]
  attachments: AttachmentMeta[]
  settings: SharedSettings
  /** id → 删除时间。流水和附件共用一张表（id 是 uuid，不会撞） */
  tombstones: Record<Id, IsoString>
}

export interface LocalChanges {
  /** 要写回本机的记录（远端更新，或本机没有的） */
  expenses: Expense[]
  categories: Category[]
  attachments: AttachmentMeta[]
  settings: SharedSettings | null
  /** 因为远端墓碑而要从本机删掉的 */
  removedExpenseIds: Id[]
  removedAttachmentIds: Id[]
}

export interface MergeResult {
  merged: SyncSnapshot
  applied: LocalChanges
  /** 本机有、远端没有的附件 → 要上传 */
  uploadAttachmentIds: Id[]
  /** 远端有、本机没有的附件 → 要下载 */
  downloadAttachmentIds: Id[]
  stats: { expensesKept: number; remoteWins: number; deleted: number }
}

export function emptySnapshot(settings: Settings, schemaVersion: number, now: IsoString): SyncSnapshot {
  return {
    schemaVersion,
    generatedAt: now,
    expenses: [],
    categories: [],
    attachments: [],
    settings: toSharedSettings(settings),
    tombstones: {},
  }
}

/** 墓碑取并集，同 id 取更晚的删除时间 */
export function mergeTombstones(
  local: Record<Id, IsoString>,
  remote: Record<Id, IsoString>,
): Record<Id, IsoString> {
  const out: Record<Id, IsoString> = { ...remote }
  for (const [id, at] of Object.entries(local)) {
    if (!out[id] || out[id] < at) out[id] = at
  }
  return out
}

function pickWinner<T extends { id: Id; updatedAt: IsoString }>(
  localRecord: T | undefined,
  remoteRecord: T | undefined,
): { winner: T | undefined; fromRemote: boolean } {
  if (!localRecord) return { winner: remoteRecord, fromRemote: Boolean(remoteRecord) }
  if (!remoteRecord) return { winner: localRecord, fromRemote: false }
  // 同时间戳时留本机，保证结果稳定（两边算出来的合并结果一致会更好，但本机优先足够用）
  return remoteRecord.updatedAt > localRecord.updatedAt
    ? { winner: remoteRecord, fromRemote: true }
    : { winner: localRecord, fromRemote: false }
}

function mergeCollection<T extends { id: Id; updatedAt: IsoString }>(
  localList: T[],
  remoteList: T[],
  tombstones: Record<Id, IsoString>,
): { kept: T[]; applied: T[]; removed: Id[]; remoteWins: number; deleted: number } {
  const localMap = new Map(localList.map((item) => [item.id, item]))
  const remoteMap = new Map(remoteList.map((item) => [item.id, item]))
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()])

  const kept: T[] = []
  const applied: T[] = []
  const removed: Id[] = []
  let remoteWins = 0
  let deleted = 0

  for (const id of ids) {
    const localRecord = localMap.get(id)
    const remoteRecord = remoteMap.get(id)
    const deletedAt = tombstones[id]

    let candidate: T | undefined
    let fromRemote = false
    if (deletedAt) {
      // 删后又编辑过（时间更晚）才留下，否则认为已被删除
      const localAlive = localRecord && localRecord.updatedAt > deletedAt
      const remoteAlive = remoteRecord && remoteRecord.updatedAt > deletedAt
      if (localAlive && remoteAlive) {
        const picked = pickWinner(localRecord, remoteRecord)
        candidate = picked.winner
        fromRemote = picked.fromRemote
      } else if (localAlive) {
        candidate = localRecord
      } else if (remoteAlive) {
        candidate = remoteRecord
        fromRemote = true
      } else {
        candidate = undefined
        deleted += 1
      }
    } else {
      const picked = pickWinner(localRecord, remoteRecord)
      candidate = picked.winner
      fromRemote = picked.fromRemote
    }

    if (!candidate) {
      if (localRecord) removed.push(id)
      continue
    }

    kept.push(candidate)
    if (fromRemote) {
      remoteWins += 1
      applied.push(candidate)
    }
  }

  return { kept, applied, removed, remoteWins, deleted }
}

export function mergeStates(
  local: SyncSnapshot,
  remote: SyncSnapshot | null,
  schemaVersion: number,
  now: IsoString,
): MergeResult {
  if (!remote) {
    return {
      merged: { ...local, schemaVersion, generatedAt: now },
      applied: { expenses: [], categories: [], attachments: [], settings: null, removedExpenseIds: [], removedAttachmentIds: [] },
      uploadAttachmentIds: local.attachments.map((a) => a.id),
      downloadAttachmentIds: [],
      stats: { expensesKept: local.expenses.length, remoteWins: 0, deleted: 0 },
    }
  }

  const tombstones = mergeTombstones(local.tombstones, remote.tombstones)

  const expenses = mergeCollection(local.expenses, remote.expenses, tombstones)
  const categories = mergeCollection(local.categories, remote.categories, tombstones)

  // 附件：不可变，只求并集；被墓碑标记且不是删后新建的就去掉
  const localAttachments = new Map(local.attachments.map((a) => [a.id, a]))
  const remoteAttachments = new Map(remote.attachments.map((a) => [a.id, a]))
  const attachmentIds = new Set([...localAttachments.keys(), ...remoteAttachments.keys()])
  const keptAttachments: AttachmentMeta[] = []
  const appliedAttachments: AttachmentMeta[] = []
  const removedAttachmentIds: Id[] = []

  for (const id of attachmentIds) {
    const aliveLocally = localAttachments.get(id)
    const aliveRemotely = remoteAttachments.get(id)
    const deletedAt = tombstones[id]
    if (deletedAt) {
      // 附件没有 updatedAt，用 createdAt 判断「删后新建」
      const alive = aliveLocally && aliveLocally.createdAt > deletedAt
      if (!alive) {
        if (aliveLocally) removedAttachmentIds.push(id)
        continue
      }
    }
    const winner = aliveLocally ?? aliveRemotely
    if (!winner) continue
    keptAttachments.push(winner)
    if (!aliveLocally && aliveRemotely) appliedAttachments.push(aliveRemotely)
  }

  const settings =
    remote.settings.updatedAt > local.settings.updatedAt ? remote.settings : local.settings

  const merged: SyncSnapshot = {
    schemaVersion,
    generatedAt: now,
    expenses: expenses.kept,
    categories: categories.kept,
    attachments: keptAttachments,
    settings,
    tombstones,
  }

  return {
    merged,
    applied: {
      expenses: expenses.applied,
      categories: categories.applied,
      attachments: appliedAttachments,
      settings: settings === remote.settings && remote.settings.updatedAt > local.settings.updatedAt ? settings : null,
      removedExpenseIds: expenses.removed,
      removedAttachmentIds,
    },
    uploadAttachmentIds: keptAttachments.filter((a) => !remoteAttachments.has(a.id)).map((a) => a.id),
    downloadAttachmentIds: keptAttachments.filter((a) => !localAttachments.has(a.id)).map((a) => a.id),
    stats: {
      expensesKept: expenses.kept.length,
      remoteWins: expenses.remoteWins + categories.remoteWins,
      deleted: expenses.deleted + categories.deleted,
    },
  }
}

/** 软删除记录：超过 90 天的墓碑可以清掉，避免无限长大（清掉后极端情况下可能复活，可接受） */
export function pruneTombstones(tombstones: Record<Id, IsoString>, now: IsoString, days = 90): Record<Id, IsoString> {
  const cutoff = new Date(now).getTime() - days * 86_400_000
  const out: Record<Id, IsoString> = {}
  for (const [id, at] of Object.entries(tombstones)) {
    if (new Date(at).getTime() >= cutoff) out[id] = at
  }
  return out
}

/** 数据仓库里的附件文件名：media/<id>.<ext> */
export function attachmentPath(id: Id, mime: string): string {
  const ext =
    {
      'image/webp': 'webp',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
    }[mime] ?? 'bin'
  return `media/${id}.${ext}`
}

/** 从文件清单里反推附件 id（用于找出远端该删的文件） */
export function attachmentIdFromPath(path: string): Id | null {
  const match = /^media\/([^/]+)\.[a-z0-9]+$/i.exec(path)
  return match ? match[1] : null
}

/**
 * 快照指纹：内容一样就不推送，免得每次同步都产生一个空提交。
 * 故意不含 generatedAt（那个每次都不同）。
 */
export function snapshotFingerprint(snapshot: SyncSnapshot): string {
  const byId = <T extends { id: Id }>(list: T[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1))
  return JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    expenses: byId(snapshot.expenses),
    categories: byId(snapshot.categories),
    attachments: byId(snapshot.attachments),
    settings: { ...snapshot.settings },
    tombstones: Object.keys(snapshot.tombstones)
      .sort()
      .map((id) => [id, snapshot.tombstones[id]]),
  })
}