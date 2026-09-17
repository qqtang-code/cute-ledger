import type { ComponentType } from 'react'
import { LedgerPage } from '../ui/features/expenses/LedgerPage'
import { StatsPage } from '../ui/features/stats/StatsPage'
import { BudgetPage } from '../ui/features/budget/BudgetPage'
import { SettingsPage } from '../ui/features/settings/SettingsPage'

export interface AppRoute {
  path: string
  label: string
  icon: string
  Page: ComponentType
}

// 路由表：新增一个页面只要在这里加一行（ARCHITECTURE.md 扩展点 2）
export const routes: AppRoute[] = [
  { path: '/', label: '账本', icon: '📒', Page: LedgerPage },
  { path: '/stats', label: '统计', icon: '📊', Page: StatsPage },
  { path: '/budget', label: '预算', icon: '🎯', Page: BudgetPage },
  { path: '/settings', label: '设置', icon: '⚙️', Page: SettingsPage },
]