import { NavLink, Outlet } from 'react-router-dom'
import { routes } from './routes'
import { AddExpenseSheet } from '../ui/features/expenses/AddExpenseSheet'
import { ToastHost } from '../ui/components/ToastHost'
import { useUiStore } from '../store/ui'

export function App() {
  const addSheetOpen = useUiStore((s) => s.addSheetOpen)
  const openAddSheet = useUiStore((s) => s.openAddSheet)

  const left = routes.slice(0, 2)
  const right = routes.slice(2)

  return (
    <div className="app-shell">
      <main className="app-main">
        <Outlet />
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

      {addSheetOpen ? <AddExpenseSheet /> : null}
      <ToastHost />
    </div>
  )
}