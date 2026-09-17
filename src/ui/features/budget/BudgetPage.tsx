import { useEffect, useMemo, useState } from 'react'
import { budgetLevelLabel, budgetProgress } from '../../../domain/budget'
import { formatMonthLabel, monthKey, monthRangeOf, toDateString } from '../../../domain/dates'
import { formatCents, parseAmountToCents } from '../../../domain/money'
import type { Category, Expense } from '../../../domain/types'
import { repository, useLedgerStore } from '../../../store/ledger'
import { useUiStore } from '../../../store/ui'
import { AmountText } from '../../components/AmountText'

export function BudgetPage() {
  const categories = useLedgerStore((s) => s.categories)
  const settings = useLedgerStore((s) => s.settings)
  const saveSettings = useLedgerStore((s) => s.saveSettings)
  const saveCategory = useLedgerStore((s) => s.saveCategory)
  const itemsVersion = useLedgerStore((s) => s.items.length)
  const showToast = useUiStore((s) => s.showToast)

  const today = useMemo(() => toDateString(new Date()), [])
  const range = useMemo(() => monthRangeOf(today), [today])
  const [rows, setRows] = useState<Expense[]>([])
  const [draft, setDraft] = useState('')
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    repository.expensesInRange(range.from, range.to).then((list) => {
      if (alive) setRows(list)
    })
    return () => {
      alive = false
    }
  }, [range.from, range.to, itemsVersion])

  const spentTotal = rows.reduce((sum, e) => sum + e.amountCents, 0)
  const progress = budgetProgress(spentTotal, settings.monthlyBudgetCents)
  const symbol = settings.currencySymbol

  const spentByCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of rows) map.set(e.categoryId, (map.get(e.categoryId) ?? 0) + e.amountCents)
    return map
  }, [rows])

  async function saveTotalBudget() {
    if (draft.trim() === '') {
      await saveSettings({ monthlyBudgetCents: 0 })
      showToast('已取消总预算')
      return
    }
    const parsed = parseAmountToCents(draft)
    if (!parsed.ok) {
      showToast(parsed.reason)
      return
    }
    await saveSettings({ monthlyBudgetCents: parsed.cents })
    setDraft('')
    showToast('总预算存好了')
  }

  async function saveCategoryBudget(category: Category) {
    const raw = (categoryDrafts[category.id] ?? '').trim()
    if (raw === '') {
      const cleared = { ...category }
      delete cleared.monthlyBudgetCents
      await saveCategory(cleared)
      showToast(`已取消「${category.name}」的预算`)
      return
    }
    const parsed = parseAmountToCents(raw)
    if (!parsed.ok) {
      showToast(parsed.reason)
      return
    }
    await saveCategory({ ...category, monthlyBudgetCents: parsed.cents })
    setCategoryDrafts((prev) => ({ ...prev, [category.id]: '' }))
    showToast(`「${category.name}」的预算存好了`)
  }

  const activeCategories = categories.filter((c) => !c.archived)

  return (
    <section data-testid="page-budget">
      <h1 className="page-title">预算</h1>

      <div className="card">
        <p className="dim">{formatMonthLabel(monthKey(today))}总预算</p>
        {progress.hasBudget ? (
          <>
            <p className="budget__numbers">
              <AmountText cents={progress.spentCents} symbol={symbol} size="lg" />
              <span className="dim"> / {formatCents(progress.budgetCents, symbol)}</span>
            </p>
            <div className={`progress progress--${progress.level}`} data-testid="budget-bar" data-level={progress.level}>
              <div className="progress__fill" style={{ width: `${Math.round(progress.barRatio * 100)}%` }} />
            </div>
            <p className="dim" data-testid="budget-status">
              {progress.level === 'over'
                ? `已超支 ${formatCents(progress.overCents, symbol)}`
                : `还能花 ${formatCents(progress.remainingCents, symbol)}（${budgetLevelLabel(progress.level)}）`}
            </p>
          </>
        ) : (
          <p className="dim" data-testid="budget-none">
            还没设预算。设了之后这里会显示进度和超支提醒。
          </p>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <input
            type="text"
            inputMode="decimal"
            placeholder="比如 3000"
            aria-label="月度总预算"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            data-testid="budget-input"
          />
          <button type="button" className="btn" onClick={() => void saveTotalBudget()} data-testid="save-budget">
            保存
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">分类预算</h2>
        <ul className="budget-list">
          {activeCategories.map((category) => {
            const spent = spentByCategory.get(category.id) ?? 0
            const categoryProgress = budgetProgress(spent, category.monthlyBudgetCents ?? 0)
            return (
              <li key={category.id} className="budget-item" data-testid={`budget-category-${category.id}`}>
                <div className="budget-item__head">
                  <span>
                    <span aria-hidden="true">{category.emoji}</span> {category.name}
                  </span>
                  <span className="dim">
                    {formatCents(spent, symbol)}
                    {categoryProgress.hasBudget ? ` / ${formatCents(categoryProgress.budgetCents, symbol)}` : ''}
                  </span>
                </div>
                {categoryProgress.hasBudget ? (
                  <div className={`progress progress--${categoryProgress.level}`}>
                    <div className="progress__fill" style={{ width: `${Math.round(categoryProgress.barRatio * 100)}%` }} />
                  </div>
                ) : null}
                <div className="row">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={categoryProgress.hasBudget ? '改预算' : '设个预算'}
                    aria-label={`${category.name} 的预算`}
                    value={categoryDrafts[category.id] ?? ''}
                    onChange={(event) => setCategoryDrafts((prev) => ({ ...prev, [category.id]: event.target.value }))}
                    data-testid={`budget-input-${category.id}`}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void saveCategoryBudget(category)}
                    data-testid={`save-budget-${category.id}`}
                  >
                    保存
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}