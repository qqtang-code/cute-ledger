import type { Attachment, Category, Expense, DateString, Id } from '../domain/types'
import { monthKey, monthRangeOf } from '../domain/dates'
import { summarize, type Summary } from '../domain/stats'
import type { StorageAdapter } from './ports'

export interface CategoryWithUsage {
  category: Category
  /** 被多少笔流水引用（决定能不能硬删） */
  expenseCount: number
}

/**
 * 仓储：把「业务上常问的问题」写在这里，上层（store / ui）只问问题，不关心怎么取。
 * 所有函数都通过注入的 adapter 取数——换存储时这里一行不用改。
 */
export function createRepository(adapter: StorageAdapter) {
  return {
    async listCategoriesWithUsage(): Promise<CategoryWithUsage[]> {
      const categories = await adapter.listCategories()
      return Promise.all(
        categories.map(async (category) => ({
          category,
          expenseCount: await adapter.countExpensesInCategory(category.id),
        })),
      )
    },

    async listActiveCategories(): Promise<Category[]> {
      const categories = await adapter.listCategories()
      return categories.filter((c) => !c.archived)
    },

    /** 所有出现过的标签，按出现次数倒序（给输入联想用） */
    async listTags(): Promise<string[]> {
      const expenses = await adapter.listAllExpenses()
      const counts = new Map<string, number>()
      for (const e of expenses) {
        for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag)
    },

    async attachmentsOf(expenseId: Id): Promise<Attachment[]> {
      return adapter.listAttachments(expenseId)
    },

    async expensesInRange(from: DateString, to: DateString): Promise<Expense[]> {
      const all = await adapter.listAllExpenses()
      return all.filter((e) => e.spentAt >= from && e.spentAt <= to)
    },

    /** 自然月汇总（today 传进来是为了可测，不在这里读时钟） */
    async monthSummary(monthAnchor: DateString): Promise<Summary & { monthKey: string }> {
      const range = monthRangeOf(monthAnchor)
      const list = await this.expensesInRange(range.from, range.to)
      return { ...summarize(list, range.from, range.to), monthKey: monthKey(monthAnchor) }
    },

    /** 附件总占用（字节） */
    async attachmentsBytes(): Promise<number> {
      const dump = await adapter.dump()
      return dump.attachments.reduce((sum, a) => sum + a.sizeBytes, 0)
    },
  }
}

export type Repository = ReturnType<typeof createRepository>