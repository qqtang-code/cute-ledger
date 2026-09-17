import { useEffect, useMemo, useState } from 'react'
import { formatDayLabel, formatIsoDateTime, toDateString } from '../../../domain/dates'
import { formatBytes } from '../../../domain/media'
import { formatCents } from '../../../domain/money'
import type { Attachment, Expense } from '../../../domain/types'
import { attachmentService, useLedgerStore } from '../../../store/ledger'
import { useUiStore } from '../../../store/ui'
import { Sheet } from '../../components/Sheet'
import { AttachmentThumb } from '../media/AttachmentThumb'

interface Props {
  expense: Expense
}

export function ExpenseDetailSheet({ expense }: Props) {
  const categories = useLedgerStore((s) => s.categories)
  const removeExpense = useLedgerStore((s) => s.removeExpense)
  const undoRemove = useLedgerStore((s) => s.undoRemove)
  const settings = useLedgerStore((s) => s.settings)

  const closeDetail = useUiStore((s) => s.closeDetail)
  const openViewer = useUiStore((s) => s.openViewer)
  const showToast = useUiStore((s) => s.showToast)
  const setDetailEditing = useUiStore((s) => s.setDetailEditing)
  const openAddSheet = useUiStore((s) => s.openAddSheet)

  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [confirming, setConfirming] = useState(false)

  const category = useMemo(() => categories.find((c) => c.id === expense.categoryId), [categories, expense.categoryId])
  const today = toDateString(new Date())

  useEffect(() => {
    let alive = true
    Promise.all(expense.attachmentIds.map((id) => attachmentService.load(id))).then((list) => {
      if (alive) setAttachments(list.filter((a): a is Attachment => a !== null))
    })
    return () => {
      alive = false
    }
  }, [expense.attachmentIds])

  const totalBytes = attachments.reduce((sum, a) => sum + a.sizeBytes, 0)

  async function handleDelete() {
    const snapshot = await removeExpense(expense.id)
    closeDetail()
    showToast('删掉了', {
      label: '撤销',
      run: () => {
        void undoRemove(snapshot).then(() => showToast('恢复了'))
      },
    })
  }

  return (
    <Sheet title="这笔" onClose={closeDetail} testId="detail-sheet">
      <div className="detail">
        <p className="detail__amount" data-testid="detail-amount">
          {formatCents(expense.amountCents, settings.currencySymbol)}
        </p>

        <dl className="detail__rows">
          <div className="detail__row">
            <dt>分类</dt>
            <dd>
              {category ? `${category.emoji} ${category.name}` : '未分类'}
            </dd>
          </div>
          <div className="detail__row">
            <dt>日期</dt>
            <dd>{formatDayLabel(expense.spentAt, today)}（{expense.spentAt}）</dd>
          </div>
          {expense.note ? (
            <div className="detail__row">
              <dt>备注</dt>
              <dd>{expense.note}</dd>
            </div>
          ) : null}
          {expense.tags.length > 0 ? (
            <div className="detail__row">
              <dt>标签</dt>
              <dd className="row row--wrap">
                {expense.tags.map((tag) => (
                  <span className="tag" key={tag}>
                    #{tag}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          <div className="detail__row">
            <dt>记于</dt>
            <dd className="dim">{formatIsoDateTime(expense.createdAt)}</dd>
          </div>
        </dl>

        {expense.attachmentIds.length > 0 ? (
          <div className="detail__media">
            <div className="row row--between">
              <span className="field__label">
                {expense.attachmentIds.length} 个附件 · {formatBytes(totalBytes)}
              </span>
            </div>
            <div className="thumbs">
              {expense.attachmentIds.map((id, index) => (
                <AttachmentThumb
                  key={id}
                  id={id}
                  showMeta
                  onOpen={() => openViewer(expense.attachmentIds, index)}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="detail__actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDetailEditing(true)
              openAddSheet()
            }}
            data-testid="edit-expense"
          >
            编辑
          </button>
          {confirming ? (
            <button type="button" className="btn btn--danger" onClick={handleDelete} data-testid="confirm-delete">
              确定删除
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirming(true)}
              data-testid="delete-expense"
            >
              删除
            </button>
          )}
        </div>
      </div>
    </Sheet>
  )
}