import { expect, type Page } from '@playwright/test'

export async function addExpense(
  page: Page,
  amount: string,
  options: { category?: string; note?: string } = {},
) {
  await page.getByRole('button', { name: '记一笔' }).click()
  await page.getByTestId('amount-input').fill(amount)
  if (options.category) await page.getByTestId(`category-${options.category}`).click()
  if (options.note) await page.getByTestId('note-input').fill(options.note)
  await page.getByTestId('save-expense').click()
  await expect(page.getByTestId('add-sheet')).toBeHidden()
}

/** 底部导航切页 */
export async function goto(page: Page, tab: string) {
  await page.getByRole('link', { name: new RegExp(tab) }).click()
}

/** 提示条可能同时挂着好几条，只看最新那条 */
export async function expectToast(page: Page, text: string) {
  await expect(page.getByTestId('toast').last()).toContainText(text)
}

/** 往页面的 IndexedDB 里直接塞历史记录（给翻页这类用例造数据，不走界面） */
export async function seedExpenses(page: Page, count: number) {
  await page.evaluate(async (n) => {
    const open = indexedDB.open('cute-ledger')
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const tx = db.transaction('expenses', 'readwrite')
    const store = tx.objectStore('expenses')
    for (let i = 1; i <= n; i++) {
      const day = String(((i - 1) % 28) + 1).padStart(2, '0')
      store.put({
        id: `seed-${i}`,
        amountCents: i * 100,
        categoryId: 'cat-food',
        note: `历史记录 ${i}`,
        tags: [],
        spentAt: `2026-08-${day}`,
        createdAt: `2026-08-${day}T10:00:00.000Z`,
        updatedAt: `2026-08-${day}T10:00:00.000Z`,
        attachmentIds: [],
      })
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(null)
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, count)
}