import { useState } from 'react'
import type { Category } from '../../../domain/types'
import { repository, useLedgerStore } from '../../../store/ledger'
import { useUiStore } from '../../../store/ui'
import { newId } from '../../../services/ids'

const EMOJI_CHOICES = ['🍚', '🚌', '🛍️', '🏠', '🎮', '💊', '📚', '📱', '🎁', '🐱', '✈️', '📦', '☕️', '🍰', '🎬', '💡']
const COLOR_CHOICES = ['#FF9BB3', '#7EC8E3', '#FFB86B', '#A5D6A7', '#C79BFF', '#8ED1C6', '#9FB4FF', '#B8B2C6']

/** 分类管理：增删改、排序、归档。有流水引用的分类只能归档，不能硬删。 */
export function CategoryManager() {
  const categories = useLedgerStore((s) => s.categories)
  const saveCategory = useLedgerStore((s) => s.saveCategory)
  const removeCategory = useLedgerStore((s) => s.removeCategory)
  const showToast = useUiStore((s) => s.showToast)

  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftEmoji, setDraftEmoji] = useState(EMOJI_CHOICES[0])
  const [draftColor, setDraftColor] = useState(COLOR_CHOICES[0])
  const [newOpen, setNewOpen] = useState(false)

  async function moveCategory(category: Category, delta: number) {
    const ordered = [...categories].sort((a, b) => a.order - b.order)
    const index = ordered.findIndex((c) => c.id === category.id)
    const target = index + delta
    if (target < 0 || target >= ordered.length) return
    const swapped = ordered[target]
    await saveCategory({ ...category, order: swapped.order })
    await saveCategory({ ...swapped, order: category.order })
  }

  async function handleDelete(category: Category) {
    const used = await repository.listCategoriesWithUsage()
    const count = used.find((u) => u.category.id === category.id)?.expenseCount ?? 0
    if (count > 0) {
      await saveCategory({ ...category, archived: true })
      showToast(`「${category.name}」有 ${count} 笔记录，已改为归档`)
      return
    }
    await removeCategory(category.id)
    showToast(`删掉了「${category.name}」`)
  }

  async function handleCreate() {
    const name = draftName.trim()
    if (name === '') {
      showToast('先起个名字')
      return
    }
    if (categories.some((c) => c.name === name)) {
      showToast('已经有同名分类了')
      return
    }
    const maxOrder = categories.reduce((max, c) => Math.max(max, c.order), -1)
    await saveCategory({
      id: `cat-${newId()}`,
      name,
      emoji: draftEmoji,
      color: draftColor,
      order: maxOrder + 1,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    setNewOpen(false)
    setDraftName('')
    showToast('新分类加好了')
  }

  async function handleRename(category: Category) {
    const name = draftName.trim()
    if (name === '') {
      showToast('名字不能是空的')
      return
    }
    await saveCategory({ ...category, name, emoji: draftEmoji, color: draftColor })
    setEditing(null)
    showToast('改好了')
  }

  const ordered = [...categories].sort((a, b) => a.order - b.order)

  return (
    <div className="card" data-testid="category-manager">
      <h2 className="card__title">分类管理</h2>

      <ul className="category-list">
        {ordered.map((category, index) => (
          <li key={category.id} className="category-item" data-testid={`category-row-${category.id}`}>
            {editing === category.id ? (
              <div className="form">
                <div className="row">
                  <input
                    type="text"
                    value={draftName}
                    aria-label="分类名"
                    onChange={(event) => setDraftName(event.target.value)}
                    data-testid="category-name-input"
                  />
                  <button type="button" className="btn" onClick={() => void handleRename(category)} data-testid="category-save">
                    保存
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
                    取消
                  </button>
                </div>
                <EmojiPicker emoji={draftEmoji} color={draftColor} onEmoji={setDraftEmoji} onColor={setDraftColor} />
              </div>
            ) : (
              <>
                <span className="category-item__name">
                  <span aria-hidden="true">{category.emoji}</span> {category.name}
                  {category.archived ? <span className="dim">（已归档）</span> : null}
                  {category.monthlyBudgetCents ? (
                    <span className="dim"> · 预算 {(category.monthlyBudgetCents / 100).toFixed(2)}</span>
                  ) : null}
                </span>
                <span className="category-item__ops">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`把${category.name}往上移`}
                    disabled={index === 0}
                    onClick={() => void moveCategory(category, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`把${category.name}往下移`}
                    disabled={index === ordered.length - 1}
                    onClick={() => void moveCategory(category, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`重命名${category.name}`}
                    data-testid={`category-edit-${category.id}`}
                    onClick={() => {
                      setEditing(category.id)
                      setDraftName(category.name)
                      setDraftEmoji(category.emoji)
                      setDraftColor(category.color)
                    }}
                  >
                    ✏️
                  </button>
                  {category.archived ? (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`恢复${category.name}`}
                      onClick={() => void saveCategory({ ...category, archived: false })}
                    >
                      ♻️
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`删除${category.name}`}
                    data-testid={`category-delete-${category.id}`}
                    onClick={() => void handleDelete(category)}
                  >
                    🗑️
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

      {newOpen ? (
        <div className="form" style={{ marginTop: 12 }}>
          <div className="row">
            <input
              type="text"
              placeholder="新分类名"
              aria-label="新分类名"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              data-testid="new-category-name"
            />
            <button type="button" className="btn" onClick={() => void handleCreate()} data-testid="new-category-save">
              添加
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setNewOpen(false)}>
              取消
            </button>
          </div>
          <EmojiPicker emoji={draftEmoji} color={draftColor} onEmoji={setDraftEmoji} onColor={setDraftColor} />
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--ghost"
          style={{ marginTop: 12 }}
          onClick={() => {
            setNewOpen(true)
            setDraftName('')
            setDraftEmoji(EMOJI_CHOICES[Math.floor(EMOJI_CHOICES.length / 2)] ?? '📦')
          }}
          data-testid="new-category"
        >
          ＋ 加一个分类
        </button>
      )}
    </div>
  )
}

function EmojiPicker({
  emoji,
  color,
  onEmoji,
  onColor,
}: {
  emoji: string
  color: string
  onEmoji: (value: string) => void
  onColor: (value: string) => void
}) {
  return (
    <div className="row row--wrap">
      {EMOJI_CHOICES.map((item) => (
        <button
          key={item}
          type="button"
          className={`chip ${emoji === item ? 'chip--on' : ''}`}
          onClick={() => onEmoji(item)}
          aria-label={`用 ${item} 当图标`}
        >
          {item}
        </button>
      ))}
      {COLOR_CHOICES.map((item) => (
        <button
          key={item}
          type="button"
          className="color-dot"
          style={{ background: item, outline: color === item ? '2px solid var(--c-text)' : 'none' }}
          onClick={() => onColor(item)}
          aria-label={`用 ${item} 当颜色`}
        />
      ))}
    </div>
  )
}

