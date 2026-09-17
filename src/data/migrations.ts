import type { Category, Settings } from '../domain/types'

export const DB_NAME = 'cute-ledger'

/**
 * 表结构版本。改结构时：+1 并加一个同号迁移函数 + 一条「旧数据能升上来」的单测。
 * 老迁移函数一个字都不许改（老用户的数据要靠它升上来）。
 */
export const DB_VERSION = 1

export const STORE_EXPENSES = 'expenses'
export const STORE_ATTACHMENTS = 'attachments'
export const STORE_CATEGORIES = 'categories'
export const STORE_SETTINGS = 'settings'
export const STORE_META = 'meta'

export const DEFAULT_CATEGORIES: Array<Pick<Category, 'id' | 'name' | 'emoji' | 'color' | 'order'>> = [
  { id: 'cat-food', name: '餐饮', emoji: '🍚', color: '#FF9BB3', order: 0 },
  { id: 'cat-transport', name: '交通', emoji: '🚌', color: '#7EC8E3', order: 1 },
  { id: 'cat-shopping', name: '购物', emoji: '🛍️', color: '#FFB86B', order: 2 },
  { id: 'cat-home', name: '居住', emoji: '🏠', color: '#A5D6A7', order: 3 },
  { id: 'cat-fun', name: '娱乐', emoji: '🎮', color: '#C79BFF', order: 4 },
  { id: 'cat-medical', name: '医疗', emoji: '💊', color: '#8ED1C6', order: 5 },
  { id: 'cat-study', name: '学习', emoji: '📚', color: '#9FB4FF', order: 6 },
  { id: 'cat-phone', name: '通讯', emoji: '📱', color: '#7FC8F8', order: 7 },
  { id: 'cat-gift', name: '人情', emoji: '🎁', color: '#FF9FB2', order: 8 },
  { id: 'cat-pet', name: '宠物', emoji: '🐱', color: '#FFC9A3', order: 9 },
  { id: 'cat-travel', name: '旅行', emoji: '✈️', color: '#6FD0AA', order: 10 },
  { id: 'cat-other', name: '其他', emoji: '📦', color: '#B8B2C6', order: 11 },
]

/** 迁移函数只用到这几个能力，用最小结构化类型描述，这样裸 IDB 和 idb 的包装类型都能直接传进来 */
export interface MigrationStore {
  createIndex(name: string, keyPath: string): unknown
}

export interface MigrationDb {
  createObjectStore(name: string, options?: { keyPath?: string | string[] }): MigrationStore
}

export interface MigrationTx {
  objectStore(name: string): { put(value: unknown): unknown }
}

export type Migration = (db: MigrationDb, tx: MigrationTx) => void

/**
 * 迁移函数表：upgrade 时按 oldVersion+1 → newVersion 顺序执行。
 * 每个函数只负责「从上一版升到本版」要做的事。
 */
export const migrations: Record<number, Migration> = {
  1: (db, tx) => {
    const expenses = db.createObjectStore(STORE_EXPENSES, { keyPath: 'id' })
    expenses.createIndex('spentAt', 'spentAt')
    expenses.createIndex('categoryId', 'categoryId')

    const attachments = db.createObjectStore(STORE_ATTACHMENTS, { keyPath: 'id' })
    attachments.createIndex('expenseId', 'expenseId')

    const categories = db.createObjectStore(STORE_CATEGORIES, { keyPath: 'id' })
    categories.createIndex('order', 'order')

    db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' })
    db.createObjectStore(STORE_META, { keyPath: 'key' })

    // 内置分类随建库写入，保证任何设备打开都有一套可用的分类
    const now = new Date().toISOString()
    for (const c of DEFAULT_CATEGORIES) {
      tx.objectStore(STORE_CATEGORIES).put({ ...c, archived: false, createdAt: now })
    }
    tx.objectStore(STORE_META).put({ key: 'schemaVersion', value: 1 })
  },
}

export function runMigrations(db: MigrationDb, tx: MigrationTx, oldVersion: number, newVersion: number): void {
  for (let v = oldVersion + 1; v <= newVersion; v++) {
    const migrate = migrations[v]
    if (migrate) migrate(db, tx)
  }
  tx.objectStore(STORE_META).put({ key: 'schemaVersion', value: newVersion })
}

/** 首次进入时的默认设置；以后加字段只要在这里补默认值，老数据读出来会自动补齐 */
export const DEFAULT_SETTINGS: Settings = {
  currencySymbol: '¥',
  theme: 'strawberry',
  mode: 'system',
  weekStart: 1,
  monthlyBudgetCents: 0,
  lastBackupAt: null,
  persisted: false,
}