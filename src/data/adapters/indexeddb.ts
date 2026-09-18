import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Attachment, Category, Expense, Id, Settings } from '../../domain/types'
import { filterExpenses, paginate, sortExpensesDesc } from '../../domain/filters'
import type { DataDump, ExpensePage, ExpenseQuery, ImportResult, StorageAdapter, StorageUsage } from '../ports'
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  STORE_ATTACHMENTS,
  STORE_CATEGORIES,
  STORE_EXPENSES,
  STORE_META,
  STORE_SETTINGS,
  runMigrations,
} from '../migrations'

// 这个文件是全项目唯一 import 'idb' 的地方（ARCHITECTURE.md 的硬约束，有架构测试盯着）

interface LedgerDB extends DBSchema {
  expenses: { key: string; value: Expense; indexes: { spentAt: string; categoryId: string } }
  attachments: { key: string; value: Attachment; indexes: { expenseId: string } }
  categories: { key: string; value: Category; indexes: { order: number } }
  settings: { key: string; value: { key: string; value: Settings } }
  meta: { key: string; value: { key: string; value: unknown } }
}

const SETTINGS_KEY = 'app'

type UpgradeListener = (from: number, to: number) => void

/** 具体适配器额外提供 close()：单测里要重开库就得先把连接关干净 */
export interface IndexedDbAdapter extends StorageAdapter {
  close(): void
}

export interface IndexedDbAdapterOptions {
  /** 库名。默认就是本账本的库；测试里模拟「另一台设备」时会传不同的名字 */
  dbName?: string
  onUpgrade?: UpgradeListener
}

export function createIndexedDbAdapter(options: IndexedDbAdapterOptions = {}): IndexedDbAdapter {
  const dbName = options.dbName ?? DB_NAME
  let dbPromise: Promise<IDBPDatabase<LedgerDB>> | null = null

  async function db(): Promise<IDBPDatabase<LedgerDB>> {
    if (!dbPromise) {
      dbPromise = openDB<LedgerDB>(dbName, DB_VERSION, {
        async upgrade(database, oldVersion, newVersion, transaction) {
          await runMigrations(database, transaction, oldVersion, newVersion ?? DB_VERSION)
          if (oldVersion > 0) options.onUpgrade?.(oldVersion, newVersion ?? DB_VERSION)
        },
      })
    }
    return dbPromise
  }

  function close(): void {
    const pending = dbPromise
    dbPromise = null
    void pending?.then((database) => database.close()).catch(() => undefined)
  }

  async function readSettings(): Promise<Settings> {
    const raw = await (await db()).get(STORE_SETTINGS, SETTINGS_KEY)
    // 用默认值兜底：以后 Settings 加字段，老数据读出来也不缺字段
    return { ...DEFAULT_SETTINGS, ...(raw?.value ?? {}) }
  }

  return {
    name: `indexeddb:${dbName}`,

    async init() {
      await db()
    },

    close,

    async schemaVersion() {
      const meta = await (await db()).get(STORE_META, 'schemaVersion')
      return typeof meta?.value === 'number' ? meta.value : DB_VERSION
    },

    async queryExpenses(query: ExpenseQuery): Promise<ExpensePage> {
      const database = await db()
      const all = await database.getAllFromIndex(STORE_EXPENSES, 'spentAt') // 升序取，按索引走
      const filtered = filterExpenses(sortExpensesDesc(all), query.filters)
      const { items, hasMore } = paginate(filtered, query.offset, query.limit)
      return { items, total: filtered.length, hasMore }
    },

    async listAllExpenses() {
      return sortExpensesDesc(await (await db()).getAll(STORE_EXPENSES))
    },

    async getExpense(id: Id) {
      return (await db()).get(STORE_EXPENSES, id)
    },

    async saveExpense(expense: Expense) {
      await (await db()).put(STORE_EXPENSES, expense)
    },

    async deleteExpense(id: Id) {
      const database = await db()
      const tx = database.transaction([STORE_EXPENSES, STORE_ATTACHMENTS], 'readwrite')
      const attachments = await tx.objectStore(STORE_ATTACHMENTS).index('expenseId').getAllKeys(id)
      for (const key of attachments) await tx.objectStore(STORE_ATTACHMENTS).delete(key)
      await tx.objectStore(STORE_EXPENSES).delete(id)
      await tx.done
    },

    async saveAttachment(attachment: Attachment) {
      await (await db()).put(STORE_ATTACHMENTS, attachment)
    },

    async getAttachment(id: Id) {
      return (await db()).get(STORE_ATTACHMENTS, id)
    },

    async listAttachments(expenseId: Id) {
      return (await db()).getAllFromIndex(STORE_ATTACHMENTS, 'expenseId', expenseId)
    },

    async deleteAttachment(id: Id) {
      await (await db()).delete(STORE_ATTACHMENTS, id)
    },

    async listAttachmentMeta() {
      const list = await (await db()).getAll(STORE_ATTACHMENTS)
      return list.map(({ blob: _blob, ...meta }) => meta)
    },

    async listCategories() {
      const list = await (await db()).getAllFromIndex(STORE_CATEGORIES, 'order')
      // updatedAt 兜底：万一有没迁移干净的老记录，也不让同步逻辑拿到 undefined
      return list.map((category) => ({ ...category, updatedAt: category.updatedAt ?? category.createdAt }))
    },

    async saveCategory(category: Category) {
      await (await db()).put(STORE_CATEGORIES, category)
    },

    async deleteCategory(id: Id) {
      await (await db()).delete(STORE_CATEGORIES, id)
    },

    async countExpensesInCategory(id: Id) {
      return (await db()).countFromIndex(STORE_EXPENSES, 'categoryId', id)
    },

    async getSettings() {
      return readSettings()
    },

    async saveSettings(settings: Settings) {
      await (await db()).put(STORE_SETTINGS, { key: SETTINGS_KEY, value: settings })
    },

    async getMeta<T>(key: string) {
      const record = await (await db()).get(STORE_META, key)
      return record?.value as T | undefined
    },

    async setMeta<T>(key: string, value: T) {
      await (await db()).put(STORE_META, { key, value })
    },

    async deleteMeta(key: string) {
      await (await db()).delete(STORE_META, key)
    },

    async dump(): Promise<DataDump> {
      const database = await db()
      const [expenses, attachments, categories, settings, meta] = await Promise.all([
        database.getAll(STORE_EXPENSES),
        database.getAll(STORE_ATTACHMENTS),
        database.getAllFromIndex(STORE_CATEGORIES, 'order'),
        readSettings(),
        database.get(STORE_META, 'schemaVersion'),
      ])
      return {
        schemaVersion: typeof meta?.value === 'number' ? meta.value : DB_VERSION,
        expenses: sortExpensesDesc(expenses),
        attachments,
        categories,
        settings,
      }
    },

    async bulkPut(input, mode): Promise<ImportResult> {
      const database = await db()
      const stores = [STORE_EXPENSES, STORE_ATTACHMENTS, STORE_CATEGORIES, STORE_SETTINGS] as const
      const tx = database.transaction(stores, 'readwrite')

      if (mode === 'replace') {
        for (const name of stores) await tx.objectStore(name).clear()
      }

      let skipped = 0
      for (const e of input.expenses) {
        if (!e || typeof e.id !== 'string' || typeof e.amountCents !== 'number') {
          skipped++
          continue
        }
        await tx.objectStore(STORE_EXPENSES).put(e)
      }
      for (const a of input.attachments) {
        if (!a || typeof a.id !== 'string' || !a.blob) {
          skipped++
          continue
        }
        await tx.objectStore(STORE_ATTACHMENTS).put(a)
      }
      for (const c of input.categories) {
        if (!c || typeof c.id !== 'string') {
          skipped++
          continue
        }
        await tx.objectStore(STORE_CATEGORIES).put(c)
      }
      await tx.objectStore(STORE_SETTINGS).put({
        key: SETTINGS_KEY,
        value: { ...DEFAULT_SETTINGS, ...input.settings },
      })
      await tx.done

      return {
        expenses: input.expenses.length - skipped,
        attachments: input.attachments.length,
        categories: input.categories.length,
        skipped,
      }
    },

    async wipe() {
      const database = await db()
      const stores = [STORE_EXPENSES, STORE_ATTACHMENTS, STORE_CATEGORIES, STORE_SETTINGS] as const
      const tx = database.transaction(stores, 'readwrite')
      for (const name of stores) await tx.objectStore(name).clear()
      // 清空后把内置分类补回去，不然记账没分类可选
      const now = new Date().toISOString()
      for (const c of DEFAULT_CATEGORIES) {
        await tx.objectStore(STORE_CATEGORIES).put({ ...c, archived: false, createdAt: now, updatedAt: now })
      }
      await tx.done
    },

    async usage(): Promise<StorageUsage> {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate()
        return { usedBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0 }
      }
      return { usedBytes: 0, quotaBytes: 0 }
    },
  }
}

export const __internals = { DB_NAME, DB_VERSION }