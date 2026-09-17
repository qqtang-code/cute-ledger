import { create } from 'zustand'

// 界面状态（弹层、Toast 之类），纯 UI，不碰数据
export interface Toast {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
}

interface UiState {
  addSheetOpen: boolean
  openAddSheet: () => void
  closeAddSheet: () => void
  toasts: Toast[]
  showToast: (message: string, action?: { label: string; run: () => void }) => number
  dismissToast: (id: number) => void
}

let toastSeq = 0

export const useUiStore = create<UiState>((set, get) => ({
  addSheetOpen: false,
  openAddSheet: () => set({ addSheetOpen: true }),
  closeAddSheet: () => set({ addSheetOpen: false }),
  toasts: [],
  showToast: (message, action) => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, message, actionLabel: action?.label, onAction: action?.run }] })
    return id
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))