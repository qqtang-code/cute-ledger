import { create } from 'zustand'
import { storage } from '../data/adapters'
import { createRepository } from '../data/repository'
import { createBackupService } from '../services/backup'
import { createAttachmentService, toAttachmentRecord, type PendingAttachment } from '../services/attachments'
import { createExpenseService, type ExpenseInput, type RemovedExpense } from '../services/expenses'
import { emptyFiltersValue } from '../domain/filters'
import type { Category, Expense, ExpenseFilters, Id, Settings } from '../domain/types'

export const PAGE_SIZE = 20

const repository = createRepository(storage)
const attachmentService = createAttachmentService(storage)
const backupService = createBackupService(storage)
const expenseService = createExpenseService(storage, async (pending, expenseId, now) =>
  pending.map((item: PendingAttachment) => toAttachmentRecord(item, expenseId, now)),
)

interface LedgerState {
  ready: boolean
  error: string | null
  categories: Category[]
  settings: Settings
  filters: ExpenseFilters
  items: Expense[]
  total: number
  hasMore: boolean
  loading: boolean

  init: () => Promise<void>
  reload: () => Promise<void>
  loadMore: () => Promise<void>
  setFilters: (patch: Partial<ExpenseFilters>) => Promise<void>
  clearFilters: () => Promise<void>
  addExpense: (input: ExpenseInput) => Promise<Expense>
  editExpense: (id: Id, input: ExpenseInput) => Promise<void>
  removeExpense: (id: Id) => Promise<RemovedExpense>
  undoRemove: (snapshot: RemovedExpense) => Promise<void>
  refreshCategories: () => Promise<void>
  saveCategory: (category: Category) => Promise<void>
  removeCategory: (id: Id) => Promise<void>
  wipeAll: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
}

export const useLedgerStore = create<LedgerState>((set, get) => ({
  ready: false,
  error: null,
  categories: [],
  settings: {
    currencySymbol: '¥',
    theme: 'strawberry',
    mode: 'system',
    weekStart: 1,
    monthlyBudgetCents: 0,
    lastBackupAt: null,
    persisted: false,
  },
  filters: { ...emptyFiltersValue },
  items: [],
  total: 0,
  hasMore: false,
  loading: false,

  async init() {
    try {
      await storage.init()
      const [categories, settings] = await Promise.all([storage.listCategories(), storage.getSettings()])
      set({ categories, settings, ready: true })
      await get().reload()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '数据库打不开', ready: true })
    }
  },

  async reload() {
    set({ loading: true })
    const { filters } = get()
    const page = await storage.queryExpenses({ filters, offset: 0, limit: PAGE_SIZE })
    set({ items: page.items, total: page.total, hasMore: page.hasMore, loading: false })
  },

  async loadMore() {
    const { loading, hasMore, items, filters } = get()
    if (loading || !hasMore) return
    set({ loading: true })
    const page = await storage.queryExpenses({ filters, offset: items.length, limit: PAGE_SIZE })
    set({
      items: [...items, ...page.items],
      total: page.total,
      hasMore: page.hasMore,
      loading: false,
    })
  },

  async setFilters(patch) {
    set({ filters: { ...get().filters, ...patch } })
    await get().reload()
  },

  async clearFilters() {
    set({ filters: { ...emptyFiltersValue } })
    await get().reload()
  },

  async addExpense(input) {
    const expense = await expenseService.create(input)
    await get().reload()
    return expense
  },

  async editExpense(id, input) {
    await expenseService.update(id, input)
    await get().reload()
  },

  async removeExpense(id) {
    const snapshot = await expenseService.remove(id)
    await get().reload()
    return snapshot
  },

  async undoRemove(snapshot) {
    await expenseService.restore(snapshot)
    await get().reload()
  },

  async refreshCategories() {
    set({ categories: await storage.listCategories() })
  },

  async saveCategory(category) {
    await storage.saveCategory(category)
    await get().refreshCategories()
  },

  async removeCategory(id) {
    // 有流水引用的分类不许硬删——上层负责改成归档，这里再兜一道
    const used = await storage.countExpensesInCategory(id)
    if (used > 0) throw new Error(`这个分类下还有 ${used} 笔记录，不能删（可以归档）`)
    await storage.deleteCategory(id)
    await get().refreshCategories()
  },

  async wipeAll() {
    await storage.wipe()
    await get().refreshCategories()
    await get().reload()
  },

  async saveSettings(patch) {
    const next = { ...get().settings, ...patch }
    await storage.saveSettings(next)
    set({ settings: next })
  },
}))

export { attachmentService, backupService, expenseService, repository }