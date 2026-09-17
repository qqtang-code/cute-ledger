import type { Attachment, Category, Expense, ExpenseFilters, Id, Settings } from '../domain/types'

export interface ExpenseQuery {
  filters: ExpenseFilters
  offset: number
  limit: number
}

export interface ExpensePage {
  items: Expense[]
  total: number
  hasMore: boolean
}

export interface DataDump {
  schemaVersion: number
  expenses: Expense[]
  attachments: Attachment[]
  categories: Category[]
  settings: Settings
}

export interface ImportResult {
  expenses: number
  attachments: number
  categories: number
  skipped: number
}

export interface StorageUsage {
  usedBytes: number
  quotaBytes: number
}

/**
 * 存储契约：全项目唯一的存储入口（ARCHITECTURE.md 扩展点 3）。
 * 想换成云同步，只要再实现一份这个接口，界面一行都不用改。
 */
export interface StorageAdapter {
  readonly name: string
  init(): Promise<void>
  schemaVersion(): Promise<number>

  queryExpenses(query: ExpenseQuery): Promise<ExpensePage>
  listAllExpenses(): Promise<Expense[]>
  getExpense(id: Id): Promise<Expense | undefined>
  saveExpense(expense: Expense): Promise<void>
  deleteExpense(id: Id): Promise<void>

  saveAttachment(attachment: Attachment): Promise<void>
  getAttachment(id: Id): Promise<Attachment | undefined>
  listAttachments(expenseId: Id): Promise<Attachment[]>
  deleteAttachment(id: Id): Promise<void>

  listCategories(): Promise<Category[]>
  saveCategory(category: Category): Promise<void>
  deleteCategory(id: Id): Promise<void>
  countExpensesInCategory(id: Id): Promise<number>

  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>

  dump(): Promise<DataDump>
  bulkPut(dump: Omit<DataDump, 'schemaVersion'>, mode: 'merge' | 'replace'): Promise<ImportResult>
  wipe(): Promise<void>
  usage(): Promise<StorageUsage>
}