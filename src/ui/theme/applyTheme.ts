import type { Settings } from '../../domain/types'

function resolveMode(mode: Settings['mode']): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 主题只改 <html> 上的两个属性，样式全在 tokens.css 里（换主题不用改组件） */
export function applyTheme(settings: Settings): void {
  const root = document.documentElement
  root.dataset.theme = settings.theme
  root.dataset.mode = resolveMode(settings.mode)

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolveMode(settings.mode) === 'dark' ? '#1c1a21' : '#FF9BB3')
}

/** 跟随系统时要跟着系统切换走 */
export function watchSystemTheme(settings: Settings, onChange: () => void): () => void {
  if (settings.mode !== 'system' || !window.matchMedia) return () => undefined
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}