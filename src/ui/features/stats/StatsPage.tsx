import { useEffect, useMemo, useState } from 'react'
import {
  daysInRange,
  formatMonthLabel,
  monthKey,
  previousPeriod,
  rangePreset,
  toDateString,
  type RangePreset,
} from '../../../domain/dates'
import { barRatios, categoryBreakdown, comparePeriods, dailyTotals, summarize } from '../../../domain/stats'
import { formatCents } from '../../../domain/money'
import type { DateString, Expense } from '../../../domain/types'
import { repository, useLedgerStore } from '../../../store/ledger'
import { AmountText } from '../../components/AmountText'
import { BarChart, DonutChart } from '../../components/Charts'

const PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'last30', label: '近 30 天' },
]

export function StatsPage() {
  const categories = useLedgerStore((s) => s.categories)
  const settings = useLedgerStore((s) => s.settings)
  const itemsVersion = useLedgerStore((s) => s.items.length)

  const today = useMemo(() => toDateString(new Date()), [])
  const [preset, setPreset] = useState<RangePreset>('thisMonth')
  const [customFrom, setCustomFrom] = useState<DateString | null>(null)
  const [customTo, setCustomTo] = useState<DateString | null>(null)
  const [rows, setRows] = useState<Expense[]>([])
  const [previousRows, setPreviousRows] = useState<Expense[]>([])

  const range = useMemo(() => {
    if (customFrom && customTo) return { from: customFrom, to: customTo }
    return rangePreset(preset, today, settings.weekStart)
  }, [preset, today, settings.weekStart, customFrom, customTo])

  // itemsVersion 变化说明账本改过了，统计要跟着重算
  useEffect(() => {
    let alive = true
    Promise.all([repository.expensesInRange(range.from, range.to), repository.expensesInRange(
      previousPeriod(range.from, range.to).from,
      previousPeriod(range.from, range.to).to,
    )]).then(([current, previous]) => {
      if (!alive) return
      setRows(current)
      setPreviousRows(previous)
    })
    return () => {
      alive = false
    }
  }, [range.from, range.to, itemsVersion])

  if (!settings) return null

  const summary = summarize(rows, range.from, range.to)
  const slices = categoryBreakdown(rows)
  const daily = dailyTotals(rows, daysInRange(range.from, range.to))
  const previousTotal = summarize(previousRows, range.from, range.to).totalCents
  const comparison = comparePeriods(summary.totalCents, previousTotal)
  const symbol = settings.currencySymbol
  const busyDays = daily.filter((d) => d.totalCents > 0).length
  const ratios = barRatios(daily.map((d) => d.totalCents))
  const peakIndex = ratios.indexOf(Math.max(...ratios, 0))

  return (
    <section data-testid="page-stats">
      <h1 className="page-title">统计</h1>

      <div className="row row--wrap" style={{ marginBottom: 12 }}>
        {PRESETS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`chip ${!customFrom && preset === item.key ? 'chip--on' : ''}`}
            onClick={() => {
              setCustomFrom(null)
              setCustomTo(null)
              setPreset(item.key)
            }}
            data-testid={`stats-preset-${item.key}`}
          >
            {item.label}
          </button>
        ))}
        <span className="dim">
          {range.from} ~ {range.to}
        </span>
      </div>

      <div className="row">
        <input
          type="date"
          value={customFrom ?? ''}
          aria-label="统计起始日期"
          data-testid="stats-from"
          onChange={(event) => {
            setCustomFrom(event.target.value || null)
            if (!customTo) setCustomTo(today)
          }}
        />
        <span className="dim">到</span>
        <input
          type="date"
          value={customTo ?? ''}
          aria-label="统计结束日期"
          data-testid="stats-to"
          onChange={(event) => {
            setCustomTo(event.target.value || null)
            if (!customFrom) setCustomFrom(rangePreset('thisMonth', today).from)
          }}
        />
      </div>

      <div className="cards" data-testid="stats-cards">
        <div className="card">
          <p className="dim">总支出</p>
          <AmountText cents={summary.totalCents} symbol={symbol} size="lg" />
        </div>
        <div className="card">
          <p className="dim">日均</p>
          <AmountText cents={summary.averagePerDayCents} symbol={symbol} size="lg" />
        </div>
        <div className="card">
          <p className="dim">笔数</p>
          <p className="stat-num" data-testid="stat-count">
            {summary.count}
          </p>
        </div>
        <div className="card">
          <p className="dim">最大单笔</p>
          <AmountText cents={summary.maxExpenseCents} symbol={symbol} size="lg" />
        </div>
      </div>

      <div className="card" data-testid="stats-compare">
        <p className="dim">与上一个等长周期（{previousPeriod(range.from, range.to).from} ~ {previousPeriod(range.from, range.to).to}）比</p>
        <p className={`compare compare--${comparison.direction}`}>
          {comparison.direction === 'up' ? '↑ 多了 ' : comparison.direction === 'down' ? '↓ 少了 ' : '— 持平 '}
          {comparison.direction === 'flat' ? '' : formatCents(Math.abs(comparison.deltaCents), symbol)}
          {comparison.deltaRatio === null ? '（上期没有记录）' : `（${(comparison.deltaRatio * 100).toFixed(0)}%）`}
        </p>
      </div>

      <div className="card" data-testid="stats-donut">
        <h2 className="card__title">分类占比</h2>
        <DonutChart slices={slices} categories={categories} symbol={symbol} />
      </div>

      <div className="card" data-testid="stats-bars">
        <h2 className="card__title">每日趋势</h2>
        <BarChart data={daily} symbol={symbol} />
        <p className="dim" data-testid="stats-busy">
          {busyDays > 0
            ? `${daily.length} 天里有 ${busyDays} 天花钱，最高的一天是 ${daily[peakIndex]?.date}（${formatCents(daily[peakIndex]?.totalCents ?? 0, symbol)}）`
            : '这段时间没有花钱记录'}
        </p>
      </div>

      <p className="dim center">
        当前区间：{formatMonthLabel(monthKey(range.from))}起 —— 共 {daily.length} 天
      </p>
    </section>
  )
}