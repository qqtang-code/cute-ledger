import { useUiStore } from '../../../store/ui'

// 任务 1 占位；任务 3 换成真正的记账表单（金额、分类、日期、备注、标签、附件）
export function AddExpenseSheet() {
  const closeAddSheet = useUiStore((s) => s.closeAddSheet)

  return (
    <>
      <div className="sheet-backdrop" onClick={closeAddSheet} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="记一笔" data-testid="add-sheet">
        <h2 className="page-title">记一笔</h2>
        <p className="dim">表单会在任务 3 接上：金额、分类、日期、备注、标签、图片视频。</p>
        <button type="button" className="btn btn--ghost" onClick={closeAddSheet} style={{ marginTop: 16 }}>
          关闭
        </button>
      </div>
    </>
  )
}