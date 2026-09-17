import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDayLabel, groupByDay, monthRangeOf, toDateString } from '../../../domain/dates'
import { describeFilters, hasActiveFilters } from '../../../domain/filters'
import { formatCents, sumExpenseCents } from '../../../domain/money'
import { useLedgerStore } from '../../../store/ledger'
import { useUiStore } from '../../../store/ui'
import { AmountText } from '../../components/AmountText'
import { EmptyState } from '../../components/EmptyState'
import { AttachmentThumb } from '../media/AttachmentThumb'
import { FilterSheet } from './FilterSheet'
import { formatMonthLabel, monthKey } from '../../../domain/dates'

export function LedgerPage() {
  const items = useLedgerStore((s) => s.items)
  const total = useLedgerStore((s) => s.total)
  const hasMore = useLedgerStore((s) => s.hasMore)
  const loading = useLedgerStore((s) => s.loading)
  const filters = useLedgerStore((s) => s.filters)
  const categories = useLedgerStore((s) => s.categories)
  const settings = useLedgerStore((s) => s.settings)
  const setFilters = useLedgerStore((s) => s.setFilters)
  const loadMore = useLedgerStore((s) => s.loadMore)
  const clearFilters = useLedgerStore((s) => s.clearFilters)

  const openDetail = useUiStore((s) => s.openDetail)
  const openAddSheet = useUiStore((s) => s.openAddSheet)
  const highlightId = useUiStore((s) => s.highlightId)

  const [filterOpen, setFilterOpen] = useState(false)
  const [search, setSearch] = useState(filters.text)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const today = useMemo(() => toDateString(new Date()), [])
  const groups = useMemo(() => groupByDay(items), [items])
  const monthTotal = useMemo(() => {
    const range = monthRangeOf(today)
    return sumExpenseCents(items.filter((e) => e.spentAt >= range.from && e.spentAt <= range.to))
  }, [items, today])

  const filtered = hasActiveFilters(filters)
  const chips = describeFilters(filters, (id) => categories.find((c) => c.id === id)?.name ?? '未知分类')

  // 上滑自动加载下一页：提前 200px 就开始加载，滑到底时不用等
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loadMore, items.length])

  return (
    <section data-testid="page-ledger">
      <header className="ledger-head">
        <div>
          <p className="dim">{formatMonthLabel(monthKey(today))}花了</p>
          <AmountText cents={monthTotal} symbol={settings.currencySymbol} size="xl" />
        </div>
        <div className="ledger-head__meta dim">{total} 笔记录</div>
      </header>

      <div className="row row--search">
        <input
          type="search"
          value={search}
          placeholder="搜备注或标签"
          aria-label="搜索"
          data-testid="search-input"
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void setFilters({ text: search })
          }}
        />
        <button type="button" className="btn btn--ghost" onClick={() => void setFilters({ text: search })} data-testid="search-go">
          搜
        </button>
        <button
          type="button"
          className={`btn btn--ghost ${filtered ? 'btn--on' : ''}`}
          onClick={() => setFilterOpen(true)}
          data-testid="open-filters"
        >
          筛选{filtered ? '·' : ''}
        </button>
      </div>

      {filtered ? (
        <div className="row row--wrap" data-testid="active-filters">
          {chips.map((chip) => (
            <span className="tag" key={chip}>
              {chip}
            </span>
          ))}
          <span className="dim" data-testid="filter-summary">
            筛出 {total} 笔 / 合计 {formatCents(sumExpenseCents(items), settings.currencySymbol)}
          </span>
          <button
            type="button"
            className="tag tag--ghost"
            onClick={() => {
              setSearch('')
              void clearFilters()
            }}
            data-testid="clear-filters"
          >
            清空
          </button>
        </div>
      ) : null}

      {groups.length === 0 && !loading ? (
        filtered ? (
          <EmptyState title="没有符合条件的记录" hint="换个条件试试" testId="empty-filtered" />
        ) : (
          <EmptyState
            title="还没有记过账"
            hint="点下面的「＋」记第一笔吧"
            testId="empty-ledger"
            action={
              <button type="button" className="btn" onClick={openAddSheet}>
                记第一笔
              </button>
            }
          />
        )
      ) : null}

      {loading && items.length === 0 ? (
        <div className="skeleton-list" data-testid="ledger-skeleton" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton-row" key={i}>
              <span className="skeleton skeleton--circle" />
              <span className="skeleton skeleton--line" />
              <span className="skeleton skeleton--short" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="day-groups">
        {groups.map((group) => (
          <div className="day-group" key={group.date} data-testid="day-group">
            <div className="day-group__head">
              <span>{formatDayLabel(group.date, today)}</span>
              <span className="dim">{formatCents(group.totalCents, settings.currencySymbol)}</span>
            </div>
            <ul className="expense-list">
              {group.items.map((expense) => {
                const category = categories.find((c) => c.id === expense.categoryId)
                return (
                  <li key={expense.id}>
                    <button
                      type="button"
                      className={`expense ${highlightId === expense.id ? 'expense--new' : ''}`}
                      onClick={() => openDetail(expense.id)}
                      data-testid="expense-item"
                      data-expense-id={expense.id}
                    >
                      <span className="expense__emoji" aria-hidden="true">
                        {category?.emoji ?? '📦'}
                      </span>
                      <span className="expense__main">
                        <span className="expense__title">{category?.name ?? '未分类'}</span>
                        {expense.note ? <span className="expense__note dim">{expense.note}</span> : null}
                        {expense.tags.length > 0 ? (
                          <span className="expense__tags dim">{expense.tags.map((t) => `#${t}`).join(' ')}</span>
                        ) : null}
                      </span>
                      {expense.attachmentIds.length > 0 ? (
                        <span className="expense__media">
                          <AttachmentThumb id={expense.attachmentIds[0]} />
                          {expense.attachmentIds.length > 1 ? (
                            <span className="expense__media-count">{expense.attachmentIds.length}</span>
                          ) : null}
                        </span>
                      ) : null}
                      <span className="expense__amount">
                        <AmountText cents={expense.amountCents} symbol={settings.currencySymbol} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <div ref={sentinelRef} data-testid="list-sentinel" aria-hidden="true" style={{ height: 1 }} />
      {loading ? <p className="dim center">加载中…</p> : null}
      {!hasMore && groups.length > 0 ? (
        <p className="dim center" data-testid="list-end">
          没有更多了
        </p>
      ) : null}

      {filterOpen ? <FilterSheet onClose={() => setFilterOpen(false)} /> : null}
    </section>
  )
}