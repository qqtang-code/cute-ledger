import { useMemo, useState } from 'react'
import { toDateString } from '../../../domain/dates'
import { parseAmountToCents } from '../../../domain/money'
import type { RangePreset } from '../../../domain/dates'
import { rangePreset } from '../../../domain/dates'
import { useLedgerStore } from '../../../store/ledger'
import { Sheet } from '../../components/Sheet'

const PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: 'today', label: '今天' },
  { key: 'thisWeek', label: '本周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'last30', label: '近 30 天' },
]

interface Props {
  onClose: () => void
}

export function FilterSheet({ onClose }: Props) {
  const filters = useLedgerStore((s) => s.filters)
  const categories = useLedgerStore((s) => s.categories)
  const setFilters = useLedgerStore((s) => s.setFilters)
  const clearFilters = useLedgerStore((s) => s.clearFilters)

  const [draft, setDraft] = useState(filters)
  const [amountError, setAmountError] = useState<string | null>(null)
  const today = useMemo(() => toDateString(new Date()), [])

  function applyPreset(key: RangePreset) {
    const { from, to } = rangePreset(key, today)
    setDraft({ ...draft, from, to })
  }

  function commitAmounts(min: string, max: string) {
    const parse = (value: string): number | null | 'bad' => {
      if (value.trim() === '') return null
      const parsed = parseAmountToCents(value)
      return parsed.ok ? parsed.cents : 'bad'
    }
    const minCents = parse(min)
    const maxCents = parse(max)
    if (minCents === 'bad' || maxCents === 'bad') {
      setAmountError('金额只能填数字')
      return
    }
    if (minCents !== null && maxCents !== null && minCents > maxCents) {
      setAmountError('最小金额不能大于最大金额')
      return
    }
    setAmountError(null)
    setDraft({ ...draft, minCents, maxCents })
  }

  return (
    <Sheet
      title="筛选"
      onClose={onClose}
      testId="filter-sheet"
      footer={
        <div className="row row--gap">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setDraft({ ...draft, categoryIds: [], from: null, to: null, minCents: null, maxCents: null, onlyWithAttachments: false })
              setAmountError(null)
            }}
          >
            清空
          </button>
          <button
            type="button"
            className="btn btn--block"
            data-testid="apply-filters"
            onClick={async () => {
              await setFilters(draft)
              onClose()
            }}
          >
            应用
          </button>
        </div>
      }
    >
      <div className="form">
        <div className="field">
          <span className="field__label">日期</span>
          <div className="row row--wrap">
            {PRESETS.map((preset) => {
              const range = rangePreset(preset.key, today)
              const on = draft.from === range.from && draft.to === range.to
              return (
                <button
                  key={preset.key}
                  type="button"
                  className={`chip ${on ? 'chip--on' : ''}`}
                  onClick={() => applyPreset(preset.key)}
                  data-testid={`preset-${preset.key}`}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
          <div className="row">
            <input
              type="date"
              value={draft.from ?? ''}
              aria-label="起始日期"
              onChange={(event) => setDraft({ ...draft, from: event.target.value || null })}
              data-testid="filter-from"
            />
            <span className="dim">到</span>
            <input
              type="date"
              value={draft.to ?? ''}
              aria-label="结束日期"
              onChange={(event) => setDraft({ ...draft, to: event.target.value || null })}
              data-testid="filter-to"
            />
          </div>
        </div>

        <div className="field">
          <span className="field__label">分类（可多选）</span>
          <div className="row row--wrap">
            {categories.map((category) => {
              const on = draft.categoryIds.includes(category.id)
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`chip ${on ? 'chip--on' : ''}`}
                  aria-pressed={on}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      categoryIds: on
                        ? draft.categoryIds.filter((id) => id !== category.id)
                        : [...draft.categoryIds, category.id],
                    })
                  }
                  data-testid={`filter-category-${category.id}`}
                >
                  <span aria-hidden="true">{category.emoji}</span>
                  {category.name}
                </button>
              )
            })}
          </div>
        </div>

        <div className="field">
          <span className="field__label">金额区间（元）</span>
          <div className="row">
            <input
              type="text"
              inputMode="decimal"
              placeholder="最小"
              defaultValue={draft.minCents === null ? '' : (draft.minCents / 100).toFixed(2)}
              aria-label="最小金额"
              onBlur={(event) => commitAmounts(event.target.value, draft.maxCents === null ? '' : (draft.maxCents / 100).toFixed(2))}
              data-testid="filter-min"
            />
            <span className="dim">~</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="最大"
              defaultValue={draft.maxCents === null ? '' : (draft.maxCents / 100).toFixed(2)}
              aria-label="最大金额"
              onBlur={(event) => commitAmounts(draft.minCents === null ? '' : (draft.minCents / 100).toFixed(2), event.target.value)}
              data-testid="filter-max"
            />
          </div>
          {amountError ? <p className="form__error">{amountError}</p> : null}
        </div>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={draft.onlyWithAttachments}
            onChange={(event) => setDraft({ ...draft, onlyWithAttachments: event.target.checked })}
            data-testid="filter-has-media"
          />
          <span>只看有图片/视频的</span>
        </label>

        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            void clearFilters()
            onClose()
          }}
          data-testid="reset-filters"
        >
          清空全部条件
        </button>
      </div>
    </Sheet>
  )
}