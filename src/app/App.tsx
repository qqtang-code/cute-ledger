import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { routes } from './routes'
import { AddExpenseSheet } from '../ui/features/expenses/AddExpenseSheet'
import { ExpenseDetailSheet } from '../ui/features/expenses/ExpenseDetailSheet'
import { ImageViewer } from '../ui/features/media/ImageViewer'
import { ToastHost } from '../ui/components/ToastHost'
import { useLedgerStore } from '../store/ledger'
import { useUiStore } from '../store/ui'
import { applyTheme, watchSystemTheme } from '../ui/theme/applyTheme'

export function App() {
  const ready = useLedgerStore((s) => s.ready)
  const error = useLedgerStore((s) => s.error)
  const items = useLedgerStore((s) => s.items)
  const settings = useLedgerStore((s) => s.settings)
  const init = useLedgerStore((s) => s.init)

  const addSheetOpen = useUiStore((s) => s.addSheetOpen)
  const openAddSheet = useUiStore((s) => s.openAddSheet)
  const detailId = useUiStore((s) => s.detailId)
  const detailEditing = useUiStore((s) => s.detailEditing)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    applyTheme(settings)
    return watchSystemTheme(settings, () => applyTheme(settings))
  }, [settings])

  const left = routes.slice(0, 2)
  const right = routes.slice(2)
  const detailExpense = detailId ? (items.find((e) => e.id === detailId) ?? null) : null

  return (
    <div className="app-shell">
      <main className="app-main">
        {error ? (
          <div className="card" role="alert">
            <p>数据库打不开：{error}</p>
            <p className="dim">试试关掉无痕模式，或者换一个浏览器。</p>
          </div>
        ) : null}
        {ready ? <Outlet /> : <p className="dim center">正在打开小账本…</p>}
      </main>

      <nav className="bottom-nav" aria-label="主导航">
        {left.map((r) => (
          <NavLink key={r.path} to={r.path} end={r.path === '/'} className="nav-item">
            <span className="nav-item__icon" aria-hidden="true">
              {r.icon}
            </span>
            <span>{r.label}</span>
          </NavLink>
        ))}

        <button type="button" className="nav-add" aria-label="记一笔" onClick={openAddSheet}>
          ＋
        </button>

        {right.map((r) => (
          <NavLink key={r.path} to={r.path} className="nav-item">
            <span className="nav-item__icon" aria-hidden="true">
              {r.icon}
            </span>
            <span>{r.label}</span>
          </NavLink>
        ))}
      </nav>

      {addSheetOpen ? <AddExpenseSheet editing={detailEditing ? detailExpense : null} /> : null}
      {detailExpense && !addSheetOpen ? <ExpenseDetailSheet expense={detailExpense} /> : null}
      <ImageViewer />
      <ToastHost />
    </div>
  )
}