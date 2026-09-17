import type { Attachment, Category, Expense, Settings } from '../domain/types'

let seq = 0

export function makeExpense(over: Partial<Expense> = {}): Expense {
  seq += 1
  return {
    id: over.id ?? `exp-${seq}`,
    amountCents: over.amountCents ?? 1000,
    categoryId: over.categoryId ?? 'cat-food',
    note: over.note ?? '',
    tags: over.tags ?? [],
    spentAt: over.spentAt ?? '2026-09-17',
    createdAt: over.createdAt ?? `2026-09-17T10:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    updatedAt: over.updatedAt ?? '2026-09-17T10:00:00.000Z',
    attachmentIds: over.attachmentIds ?? [],
  }
}

export function makeAttachment(over: Partial<Attachment> = {}): Attachment {
  seq += 1
  const bytes = over.sizeBytes ?? 1024
  return {
    id: over.id ?? `att-${seq}`,
    expenseId: over.expenseId ?? 'exp-1',
    kind: over.kind ?? 'image',
    blob: over.blob ?? new Blob([new Uint8Array(bytes)], { type: 'image/webp' }),
    mime: over.mime ?? 'image/webp',
    width: over.width ?? 800,
    height: over.height ?? 600,
    sizeBytes: bytes,
    createdAt: over.createdAt ?? '2026-09-17T10:00:00.000Z',
  }
}

export function makeCategory(over: Partial<Category> = {}): Category {
  seq += 1
  return {
    id: over.id ?? `cat-${seq}`,
    name: over.name ?? `分类${seq}`,
    emoji: over.emoji ?? '🍙',
    color: over.color ?? '#FF9BB3',
    order: over.order ?? seq,
    archived: over.archived ?? false,
    createdAt: over.createdAt ?? '2026-09-17T10:00:00.000Z',
    updatedAt: over.updatedAt ?? over.createdAt ?? '2026-09-17T10:00:00.000Z',
  }
}

export const makeSettings = (over: Partial<Settings> = {}): Settings => ({
  currencySymbol: '¥',
  theme: 'strawberry',
  mode: 'system',
  weekStart: 1,
  monthlyBudgetCents: 0,
  lastBackupAt: null,
  persisted: false,
  updatedAt: '2026-09-17T10:00:00.000Z',
  syncRepo: '',
  syncBranch: 'main',
  syncEnabled: false,
  lastSyncAt: null,
  ...over,
})