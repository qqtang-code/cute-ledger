import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDayLabel, parseDateString, toDateString } from '../../../domain/dates'
import { budgetProgress } from '../../../domain/budget'
import { formatCents, parseAmountToCents } from '../../../domain/money'
import { MAX_TAGS } from '../../../domain/media'
import type { DateString, Expense } from '../../../domain/types'
import { repository, useLedgerStore } from '../../../store/ledger'
import { useUiStore } from '../../../store/ui'
import { Sheet } from '../../components/Sheet'
import { AttachmentPicker } from '../media/AttachmentPicker'
import type { PendingAttachment } from '../../../services/attachments'

interface Props {
  /** 传了就是编辑，没传就是新增 */
  editing?: Expense | null
}

export function AddExpenseSheet({ editing = null }: Props) {
  const categories = useLedgerStore((s) => s.categories)
  const settings = useLedgerStore((s) => s.settings)
  const today = useMemo(() => toDateString(new Date()), [])
  const addExpense = useLedgerStore((s) => s.addExpense)
  const editExpense = useLedgerStore((s) => s.editExpense)

  const closeAddSheet = useUiStore((s) => s.closeAddSheet)
  const setHighlight = useUiStore((s) => s.setHighlight)
  const showToast = useUiStore((s) => s.showToast)

  const activeCategories = useMemo(() => categories.filter((c) => !c.archived), [categories])

  const [amount, setAmount] = useState(editing ? (editing.amountCents / 100).toFixed(2) : '')
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? activeCategories[0]?.id ?? '')
  const [spentAt, setSpentAt] = useState(editing?.spentAt ?? today)
  const [note, setNote] = useState(editing?.note ?? '')
  const [tags, setTags] = useState<string[]>(editing?.tags ?? [])
  const [tagDraft, setTagDraft] = useState('')
  const [kept, setKept] = useState<string[]>(editing?.attachmentIds ?? [])
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])

  const amountRef = useRef<HTMLInputElement>(null)
  const noteRef = useRef<HTMLInputElement>(null)

  // 打开就聚焦金额，这样「＋ → 金额 → 保存」三步就能记完一笔
  useEffect(() => {
    amountRef.current?.focus()
  }, [])

  useEffect(() => {
    repository.listTags().then((list) => setSuggestions(list.slice(0, 8)))
  }, [])

  function addTag(raw: string) {
    const tag = raw.trim().replace(/^#/, '')
    if (tag === '') return
    if (tags.includes(tag)) {
      setTagDraft('')
      return
    }
    if (tags.length >= MAX_TAGS) {
      setError(`最多 ${MAX_TAGS} 个标签`)
      return
    }
    setTags([...tags, tag])
    setTagDraft('')
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const parsed = parseAmountToCents(amount)
    if (!parsed.ok) {
      setError(parsed.reason)
      amountRef.current?.focus()
      return
    }
    if (!categoryId) {
      setError('请选一个分类')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentAt)) {
      setError('日期不对')
      return
    }

    setSaving(true)
    const input = {
      amountCents: parsed.cents,
      categoryId,
      spentAt,
      note,
      tags: tagDraft.trim() === '' ? tags : [...tags, tagDraft.trim().replace(/^#/, '')],
      keptAttachmentIds: kept,
      pendingAttachments: pending,
    }

    try {
      if (editing) {
        await editExpense(editing.id, input)
        useUiStore.getState().closeDetail()
        showToast('改好了')
      } else {
        const created = await addExpense(input)
        setHighlight(created.id)
        window.setTimeout(() => setHighlight(null), 2000)
        showToast(await buildSavedMessage(created.spentAt))
      }
      closeAddSheet()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  /** 存完之后给一句反馈。超预算就在同一句里提醒，但不打断保存（SPEC R7） */
  async function buildSavedMessage(spentDate: DateString): Promise<string> {
    if (settings.monthlyBudgetCents <= 0) return '记好了 ✨'
    const summary = await repository.monthSummary(spentDate)
    const progress = budgetProgress(summary.totalCents, settings.monthlyBudgetCents)
    if (progress.level === 'over') {
      return `记好了 ✨ 本月已超支 ${formatCents(progress.overCents, settings.currencySymbol)}`
    }
    if (progress.level === 'warn') {
      return `记好了 ✨ 本月已用掉预算的 ${Math.round(progress.ratio * 100)}%`
    }
    return '记好了 ✨'
  }

  const title = editing ? '改一笔' : '记一笔'

  return (
    <Sheet
      title={title}
      onClose={() => {
        if (editing) useUiStore.getState().setDetailEditing(false)
        closeAddSheet()
      }}
      testId="add-sheet"
      footer={
        <button type="submit" form="expense-form" className="btn btn--block" disabled={saving} data-testid="save-expense">
          {saving ? '保存中…' : '保存'}
        </button>
      }
    >
      <form id="expense-form" onSubmit={handleSubmit} className="form">
        <label className="field field--amount">
          <span className="field__label">金额</span>
          <input
            ref={amountRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-label="金额"
            data-testid="amount-input"
          />
        </label>

        <div className="field">
          <span className="field__label">分类</span>
          <div className="chips" role="radiogroup" aria-label="分类">
            {activeCategories.map((category) => (
              <button
                type="button"
                key={category.id}
                role="radio"
                aria-checked={categoryId === category.id}
                className={`chip ${categoryId === category.id ? 'chip--on' : ''}`}
                onClick={() => setCategoryId(category.id)}
                data-testid={`category-${category.id}`}
              >
                <span aria-hidden="true">{category.emoji}</span>
                {category.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">日期</span>
          <div className="row">
            <button type="button" className={`chip ${spentAt === today ? 'chip--on' : ''}`} onClick={() => setSpentAt(today)}>
              {formatDayLabel(today, today)}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                const d = parseDateString(today)
                d.setDate(d.getDate() - 1)
                setSpentAt(toDateString(d))
              }}
            >
              昨天
            </button>
            <input
              type="date"
              value={spentAt}
              max={today}
              onChange={(event) => setSpentAt(event.target.value)}
              aria-label="选日期"
              data-testid="date-input"
            />
          </div>
        </div>

        <label className="field">
          <span className="field__label">备注</span>
          <input
            ref={noteRef}
            type="text"
            value={note}
            placeholder="买了什么？"
            onChange={(event) => setNote(event.target.value)}
            aria-label="备注"
            data-testid="note-input"
          />
        </label>

        <div className="field">
          <span className="field__label">标签</span>
          <div className="row row--wrap">
            {tags.map((tag) => (
              <button
                type="button"
                key={tag}
                className="tag tag--removable"
                onClick={() => setTags(tags.filter((t) => t !== tag))}
                aria-label={`删除标签 ${tag}`}
              >
                #{tag} ✕
              </button>
            ))}
            <input
              type="text"
              value={tagDraft}
              placeholder="回车添加"
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addTag(tagDraft)
                }
              }}
              aria-label="添加标签"
              data-testid="tag-input"
            />
          </div>
          {suggestions.filter((s) => !tags.includes(s)).length > 0 ? (
            <div className="row row--wrap dim">
              {suggestions
                .filter((s) => !tags.includes(s))
                .slice(0, 5)
                .map((s) => (
                  <button type="button" key={s} className="tag tag--ghost" onClick={() => addTag(s)}>
                    #{s}
                  </button>
                ))}
            </div>
          ) : null}
        </div>

        <div className="field">
          <span className="field__label">图片 / 视频</span>
          <AttachmentPicker
            kept={kept}
            onKeptChange={setKept}
            pending={pending}
            onPendingChange={setPending}
            onRejections={(message) => showToast(message)}
          />
        </div>

        {error ? (
          <p className="form__error" role="alert" data-testid="form-error">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  )
}
