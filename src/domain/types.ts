// 实体类型定义（纯类型，零依赖）

/** 金额一律是整数「分」，永远不要用浮点存钱 */
export type Cents = number
/** 'YYYY-MM-DD'（本地日期，不是 UTC） */
export type DateString = string
export type Id = string
/** ISO 8601 时间戳字符串 */
export type IsoString = string

export type AttachmentKind = 'image' | 'video'

export interface Expense {
  id: Id
  amountCents: Cents
  categoryId: Id
  note: string
  tags: string[]
  spentAt: DateString
  createdAt: IsoString
  updatedAt: IsoString
  attachmentIds: Id[]
}

export interface Attachment {
  id: Id
  expenseId: Id
  kind: AttachmentKind
  blob: Blob
  mime: string
  width?: number
  height?: number
  durationMs?: number
  sizeBytes: number
  createdAt: IsoString
}

export interface Category {
  id: Id
  name: string
  emoji: string
  color: string
  order: number
  monthlyBudgetCents?: Cents
  archived: boolean
  createdAt: IsoString
}

export type ThemeName = 'strawberry' | 'mint' | 'grape'
export type ThemeMode = 'system' | 'light' | 'dark'

export interface Settings {
  currencySymbol: string
  theme: ThemeName
  mode: ThemeMode
  /** 0=周日 1=周一 */
  weekStart: 0 | 1
  monthlyBudgetCents: Cents
  lastBackupAt: IsoString | null
  persisted: boolean
}

export interface ExpenseFilters {
  text: string
  categoryIds: Id[]
  from: DateString | null
  to: DateString | null
  minCents: number | null
  maxCents: number | null
  onlyWithAttachments: boolean
}

export const emptyFilters: ExpenseFilters = {
  text: '',
  categoryIds: [],
  from: null,
  to: null,
  minCents: null,
  maxCents: null,
  onlyWithAttachments: false,
}