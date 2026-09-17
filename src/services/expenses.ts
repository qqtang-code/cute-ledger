import { validateAmountCents } from '../domain/money'
import { normalizeTags } from '../domain/media'
import { TOMBSTONES_META_KEY } from '../domain/sync'
import type { Attachment, DateString, Expense, Id, IsoString } from '../domain/types'
import type { StorageAdapter } from '../data/ports'
import type { PendingAttachment } from './attachments'
import { newId } from './ids'

async function readTombstones(adapter: StorageAdapter): Promise<Record<Id, IsoString>> {
  return (await adapter.getMeta<Record<Id, IsoString>>(TOMBSTONES_META_KEY)) ?? {}
}

/** 删除时留墓碑，多设备同步靠它把「删除」也同步过去（否则另一台会把旧记录再推回来） */
async function markDeleted(adapter: StorageAdapter, ids: Id[], at: IsoString): Promise<void> {
  const tombstones = await readTombstones(adapter)
  for (const id of ids) tombstones[id] = at
  await adapter.setMeta(TOMBSTONES_META_KEY, tombstones)
}

async function clearDeleted(adapter: StorageAdapter, ids: Id[]): Promise<void> {
  const tombstones = await readTombstones(adapter)
  let changed = false
  for (const id of ids) {
    if (tombstones[id]) {
      delete tombstones[id]
      changed = true
    }
  }
  if (changed) await adapter.setMeta(TOMBSTONES_META_KEY, tombstones)
}

export interface ExpenseInput {
  amountCents: number
  categoryId: Id
  spentAt: DateString
  note: string
  tags: string[]
  keptAttachmentIds: Id[]
  pendingAttachments: PendingAttachment[]
}

export type ValidationResult = { ok: true } | { ok: false; reason: string }

export function validateExpenseInput(input: Pick<ExpenseInput, 'amountCents' | 'categoryId' | 'spentAt'>): ValidationResult {
  const amountError = validateAmountCents(input.amountCents)
  if (amountError) return { ok: false, reason: amountError }
  if (!input.categoryId) return { ok: false, reason: '请选一个分类' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.spentAt)) return { ok: false, reason: '日期格式不对' }
  return { ok: true }
}

/** 删除后的快照，用于「撤销」把流水和附件一起恢复 */
export interface RemovedExpense {
  expense: Expense
  attachments: Attachment[]
}

export interface ExpenseService {
  create(input: ExpenseInput, now?: Date): Promise<Expense>
  update(id: Id, input: ExpenseInput, now?: Date): Promise<Expense>
  remove(id: Id): Promise<RemovedExpense>
  restore(snapshot: RemovedExpense): Promise<void>
  /** 附件里实际存了哪些（撤销恢复后要重新算） */
  attachmentIdsOf(id: Id): Promise<Id[]>
}

export function createExpenseService(adapter: StorageAdapter, attachmentsFor: (pending: PendingAttachment[], expenseId: Id, now: Date) => Promise<Attachment[]>): ExpenseService {
  async function persistAttachments(pending: PendingAttachment[], expenseId: Id, now: Date): Promise<Attachment[]> {
    if (pending.length === 0) return []
    const records = await attachmentsFor(pending, expenseId, now)
    for (const record of records) await adapter.saveAttachment(record)
    return records
  }

  return {
    async create(input, now = new Date()) {
      const check = validateExpenseInput(input)
      if (!check.ok) throw new Error(check.reason)

      const id = newId()
      const saved = await persistAttachments(input.pendingAttachments, id, now)
      const expense: Expense = {
        id,
        amountCents: input.amountCents,
        categoryId: input.categoryId,
        note: input.note.trim(),
        tags: normalizeTags(input.tags),
        spentAt: input.spentAt,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        attachmentIds: saved.map((a) => a.id),
      }
      await adapter.saveExpense(expense)
      return expense
    },

    async update(id, input, now = new Date()) {
      const check = validateExpenseInput(input)
      if (!check.ok) throw new Error(check.reason)

      const existing = await adapter.getExpense(id)
      if (!existing) throw new Error('这笔流水已经不存在了')

      // 被移除的旧附件要从库里删掉，不留孤儿
      for (const attachmentId of existing.attachmentIds) {
        if (!input.keptAttachmentIds.includes(attachmentId)) {
          await adapter.deleteAttachment(attachmentId)
        }
      }
      const saved = await persistAttachments(input.pendingAttachments, id, now)

      const expense: Expense = {
        ...existing,
        amountCents: input.amountCents,
        categoryId: input.categoryId,
        note: input.note.trim(),
        tags: normalizeTags(input.tags),
        spentAt: input.spentAt,
        updatedAt: now.toISOString(),
        attachmentIds: [...input.keptAttachmentIds, ...saved.map((a) => a.id)],
      }
      await adapter.saveExpense(expense)
      return expense
    },

    async remove(id) {
      const expense = await adapter.getExpense(id)
      if (!expense) throw new Error('这笔流水已经不存在了')
      const attachments = await adapter.listAttachments(id)
      await adapter.deleteExpense(id)
      // 流水和它的附件一起立墓碑
      await markDeleted(adapter, [id, ...attachments.map((a) => a.id)], new Date().toISOString())
      return { expense, attachments }
    },

    async restore(snapshot) {
      for (const attachment of snapshot.attachments) {
        await adapter.saveAttachment(attachment)
      }
      await adapter.saveExpense(snapshot.expense)
      // 撤销删除＝撤销墓碑，否则下次同步会被当成「已删除」再删一遍
      await clearDeleted(adapter, [snapshot.expense.id, ...snapshot.attachments.map((a) => a.id)])
    },

    async attachmentIdsOf(id) {
      const list = await adapter.listAttachments(id)
      return list.map((a) => a.id)
    },
  }
}