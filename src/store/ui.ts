import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
}

interface UiState {
  addSheetOpen: boolean
  /** 从列表点开的流水详情 */
  detailId: string | null
  detailEditing: boolean
  /** 大图/视频查看器 */
  viewer: { ids: string[]; index: number } | null
  /** 刚记完一笔记下来，列表里高亮 2 秒 */
  highlightId: string | null
  toasts: Toast[]

  openAddSheet: () => void
  closeAddSheet: () => void
  openDetail: (id: string) => void
  setDetailEditing: (editing: boolean) => void
  closeDetail: () => void
  openViewer: (ids: string[], index: number) => void
  stepViewer: (delta: number) => void
  closeViewer: () => void
  setHighlight: (id: string | null) => void
  showToast: (message: string, action?: { label: string; run: () => void }) => number
  dismissToast: (id: number) => void
}

let toastSeq = 0

/** 带「撤销」的 Toast 要留够 5 秒的撤销窗口，普通提示 3 秒就走 */
const UNDO_TOAST_MS = 6000
const PLAIN_TOAST_MS = 3000

export const useUiStore = create<UiState>((set, get) => ({
  addSheetOpen: false,
  detailId: null,
  detailEditing: false,
  viewer: null,
  highlightId: null,
  toasts: [],

  openAddSheet: () => set({ addSheetOpen: true }),
  closeAddSheet: () => set({ addSheetOpen: false }),

  openDetail: (id) => set({ detailId: id, detailEditing: false }),
  setDetailEditing: (editing) => set({ detailEditing: editing }),
  closeDetail: () => set({ detailId: null, detailEditing: false }),

  openViewer: (ids, index) => set({ viewer: { ids, index } }),
  stepViewer: (delta) => {
    const viewer = get().viewer
    if (!viewer) return
    const next = (viewer.index + delta + viewer.ids.length) % viewer.ids.length
    set({ viewer: { ...viewer, index: next } })
  },
  closeViewer: () => set({ viewer: null }),

  setHighlight: (id) => set({ highlightId: id }),

  showToast: (message, action) => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, message, actionLabel: action?.label, onAction: action?.run }] })
    // 自动消失：不然提示会一直堆在屏幕底下
    window.setTimeout(() => get().dismissToast(id), action ? UNDO_TOAST_MS : PLAIN_TOAST_MS)
    return id
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))