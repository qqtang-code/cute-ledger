import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { App } from './App'
import { routes } from './routes'
import '../ui/theme/global.css'

// HashRouter：GitHub Pages 是静态托管，子路径下用 hash 路由刷新才不会 404
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<App />}>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={<r.Page />} />
          ))}
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>,
)