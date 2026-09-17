import { create } from 'zustand'
import { storage } from '../data/adapters'
import { createRepository } from '../data/repository'
import { createBackupService } from '../services/backup'
import { createSyncService, type SyncConfig } from '../services/sync'
import type { SyncReport } from '../services/sync/engine'
import { createAttachmentService, toAttachmentRecord, type PendingAttachment } from '../services/attachments'
import { createExpenseService, type ExpenseInput, type RemovedExpense } from '../services/expenses'
import { emptyFiltersValue } from '../domain/filters'
import type { Category, Expense, ExpenseFilters, Id, Settings } from '../domain/types'

export const PAGE_SIZE = 20

/** 改动后攒 3 秒再推，避免连点几次就推几次 */
let syncTimer: number | null = null

const repository = createRepository(storage)
const attachmentService = createAttachmentService(storage)
const backupService = createBackupService(storage)
const syncService = createSyncService(storage)
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
  /** 同步状态，设置页和顶部提示用 */
  sync: {
    config: SyncConfig
    status: 'idle' | 'syncing' | 'error'
    lastMessage: string
    lastError: string | null
    lastSyncAt: string | null
  }

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
  saveSyncConfig: (patch: Partial<SyncConfig>) => Promise<void>
  testSyncConnection: () => Promise<{ ok: boolean; detail: string }>
  syncNow: () => Promise<SyncReport | null>
  /** 记完一笔之类改动后，攒一下再推，避免连点几次就推几次 */
  scheduleSync: () => void
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
    updatedAt: '1970-01-01T00:00:00.000Z',
    syncRepo: '',
    syncBranch: 'main',
    syncEnabled: false,
    lastSyncAt: null,
  },
  filters: { ...emptyFiltersValue },
  items: [],
  total: 0,
  hasMore: false,
  loading: false,
  sync: {
    config: { repo: '', branch: 'main', enabled: false, token: '' },
    status: 'idle',
    lastMessage: '',
    lastError: null,
    lastSyncAt: null,
  },

  async init() {
    try {
      await storage.init()
      const [categories, settings, syncConfig] = await Promise.all([
        storage.listCategories(),
        storage.getSettings(),
        syncService.loadConfig(),
      ])
      set({
        categories,
        settings,
        ready: true,
        sync: { ...get().sync, config: syncConfig, lastSyncAt: settings.lastSyncAt },
      })
      await get().reload()
      // 打开就拉一次：手机上记完，电脑上打开就能看到
      if (syncConfig.enabled && syncService.isConfigured(syncConfig)) {
        void get().syncNow()
      }
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
    get().scheduleSync()
    return expense
  },

  async editExpense(id, input) {
    await expenseService.update(id, input)
    await get().reload()
    get().scheduleSync()
  },

  async removeExpense(id) {
    const snapshot = await expenseService.remove(id)
    await get().reload()
    get().scheduleSync()
    return snapshot
  },

  async undoRemove(snapshot) {
    await expenseService.restore(snapshot)
    await get().reload()
    get().scheduleSync()
  },

  async refreshCategories() {
    set({ categories: await storage.listCategories() })
  },

  async saveCategory(category) {
    await storage.saveCategory({ ...category, updatedAt: new Date().toISOString() })
    await get().refreshCategories()
    get().scheduleSync()
  },

  async removeCategory(id) {
    // 有流水引用的分类不许硬删——上层负责改成归档，这里再兜一道
    const used = await storage.countExpensesInCategory(id)
    if (used > 0) throw new Error(`这个分类下还有 ${used} 笔记录，不能删（可以归档）`)
    await storage.deleteCategory(id)
    await get().refreshCategories()
    get().scheduleSync()
  },

  async wipeAll() {
    // 清空也要立墓碑：否则下次同步会把云端的记录全部拉回来
    const [expenses, attachments] = await Promise.all([storage.listAllExpenses(), storage.listAttachmentMeta()])
    const at = new Date().toISOString()
    const tombstones = (await storage.getMeta<Record<Id, string>>('syncTombstones')) ?? {}
    for (const expense of expenses) tombstones[expense.id] = at
    for (const attachment of attachments) tombstones[attachment.id] = at
    await storage.setMeta('syncTombstones', tombstones)

    await storage.wipe()
    await get().refreshCategories()
    await get().reload()
    get().scheduleSync()
  },

  async saveSettings(patch) {
    const next = { ...get().settings, ...patch, updatedAt: new Date().toISOString() }
    await storage.saveSettings(next)
    set({ settings: next })
    get().scheduleSync()
  },

  async saveSyncConfig(patch) {
    // 先乐观更新：勾选框是受控组件，等异步落库再回填的话，用户会看到勾上又自己弹回来
    set({ sync: { ...get().sync, config: { ...get().sync.config, ...patch }, lastError: null } })
    const config = await syncService.saveConfig(patch)
    const settings = await storage.getSettings()
    set({ sync: { ...get().sync, config, lastError: null }, settings })
  },

  async testSyncConnection() {
    return syncService.testConnection(get().sync.config)
  },

  async syncNow() {
    const stored = await syncService.loadConfig()
    if (!syncService.isConfigured(stored)) {
      set({ sync: { ...get().sync, config: stored, status: 'error', lastError: '还没配好数据仓库或 token' } })
      return null
    }
    set({ sync: { ...get().sync, config: stored, status: 'syncing', lastError: null } })
    try {
      const report = await syncService.syncNow(stored)
      await get().reload()
      await get().refreshCategories()
      const settings = await storage.getSettings()
      set({
        settings,
        sync: {
          config: stored,
          status: 'idle',
          lastMessage: report.message,
          lastError: null,
          lastSyncAt: report.at,
        },
      })
      return report
    } catch (error) {
      set({
        sync: {
          ...get().sync,
          config: stored,
          status: 'error',
          lastError: error instanceof Error ? error.message : '同步失败',
        },
      })
      return null
    }
  },

  scheduleSync() {
    const { config, status } = get().sync
    if (!config.enabled || !syncService.isConfigured(config)) return
    if (status === 'syncing') return
    if (syncTimer !== null) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      syncTimer = null
      // 边记边同步时，界面已经在本地更新过了，这里只需要把改动推上去
      void get().syncNow()
    }, 3000)
  },
}))

export { attachmentService, backupService, expenseService, repository, syncService }