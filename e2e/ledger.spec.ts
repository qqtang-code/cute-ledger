import { expect, test, type Page } from '@playwright/test'

const AMOUNT = 'amount-input'
const SAVE = 'save-expense'

async function addExpense(page: Page, amount: string, options: { category?: string; note?: string } = {}) {
  await page.getByRole('button', { name: '记一笔' }).click()
  await page.getByTestId(AMOUNT).fill(amount)
  if (options.category) await page.getByTestId(`category-${options.category}`).click()
  if (options.note) await page.getByTestId('note-input').fill(options.note)
  await page.getByTestId(SAVE).click()
  await expect(page.getByTestId('add-sheet')).toBeHidden()
}

/** 往页面的 IndexedDB 里直接塞历史记录：给「翻页」这类用例造数据，不走界面（界面很慢） */
async function seedExpenses(page: Page, count: number) {
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

test('记一笔：三步内完成，记完就在列表里（R1）', async ({ page }) => {
  await page.goto('/')

  // 1 点「＋」  2 填金额  3 点保存 —— 分类默认第一个、日期默认今天
  await page.getByRole('button', { name: '记一笔' }).click()
  await page.getByTestId(AMOUNT).fill('12.34')
  await page.getByTestId(SAVE).click()

  await expect(page.getByTestId('add-sheet')).toBeHidden()
  await expect(page.getByTestId('expense-item')).toHaveCount(1)
  await expect(page.getByTestId('expense-item')).toContainText('¥12.34')
})

test('刷新之后记录还在（R2：真的落到了 IndexedDB，不是内存里）', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, '88.80', { note: '刷新测试' })

  await page.reload()

  await expect(page.getByTestId('expense-item')).toHaveCount(1)
  await expect(page.getByTestId('expense-item')).toContainText('¥88.80')
  await expect(page.getByTestId('expense-item')).toContainText('刷新测试')
})

test('金额走整数分：0.1 + 0.2 = ¥0.30（R13）', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, '0.1')
  await addExpense(page, '0.2')

  await expect(page.getByTestId('day-group')).toContainText('¥0.30')
})

test('金额非法时不允许保存并给出原因（R1）', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '记一笔' }).click()

  await page.getByTestId(AMOUNT).fill('0')
  await page.getByTestId(SAVE).click()
  await expect(page.getByTestId('form-error')).toContainText('大于 0')

  await page.getByTestId(AMOUNT).fill('12.345')
  await page.getByTestId(SAVE).click()
  await expect(page.getByTestId('form-error')).toContainText('两位小数')

  await page.getByTestId(AMOUNT).fill('12.34')
  await page.getByTestId(SAVE).click()
  await expect(page.getByTestId('add-sheet')).toBeHidden()
})

test('详情页能看全信息，能编辑（R4）', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, '45.60', { category: 'cat-transport', note: '打车回家' })

  await page.getByTestId('expense-item').click()
  await expect(page.getByTestId('detail-sheet')).toBeVisible()
  await expect(page.getByTestId('detail-amount')).toHaveText('¥45.60')
  await expect(page.getByTestId('detail-sheet')).toContainText('交通')
  await expect(page.getByTestId('detail-sheet')).toContainText('打车回家')

  await page.getByTestId('edit-expense').click()
  await page.getByTestId(AMOUNT).fill('50.00')
  await page.getByTestId(SAVE).click()

  await expect(page.getByTestId('expense-item')).toContainText('¥50.00')
})

test('删除后 5 秒内能撤销（R4）', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, '66.00', { note: '会被删掉' })

  await page.getByTestId('expense-item').click()
  await page.getByTestId('delete-expense').click()
  await page.getByTestId('confirm-delete').click()

  await expect(page.getByTestId('empty-ledger')).toBeVisible()

  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.getByTestId('expense-item')).toHaveCount(1)
  await expect(page.getByTestId('expense-item')).toContainText('会被删掉')
})

test('搜索和筛选能筛出对应记录（R3）', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, '10.00', { note: '咖啡' })
  await addExpense(page, '20.00', { category: 'cat-fun', note: '电影' })
  await addExpense(page, '30.00', { note: '咖啡豆' })

  await page.getByTestId('search-input').fill('咖啡')
  await page.getByTestId('search-go').click()
  await expect(page.getByTestId('expense-item')).toHaveCount(2)
  await expect(page.getByTestId('filter-summary')).toContainText('筛出 2 笔')

  await page.getByTestId('clear-filters').click()
  await expect(page.getByTestId('expense-item')).toHaveCount(3)

  await page.getByTestId('open-filters').click()
  await page.getByTestId('filter-category-cat-fun').click()
  await page.getByTestId('apply-filters').click()
  await expect(page.getByTestId('expense-item')).toHaveCount(1)
  await expect(page.getByTestId('expense-item')).toContainText('电影')
})

test('记录多了能上滑翻页，翻到底显示没有更多了（R2）', async ({ page }) => {
  await page.goto('/')
  await seedExpenses(page, 25)
  await page.reload()

  // 首屏 20 条
  await expect(page.getByTestId('expense-item')).toHaveCount(20)

  await page.getByTestId('list-sentinel').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('expense-item')).toHaveCount(25)
  await expect(page.getByTestId('list-end')).toBeVisible()
})

test('本月合计只统计本月（R2）', async ({ page }) => {
  await page.goto('/')
  await seedExpenses(page, 3) // 都是 2026-08 的老记录
  await page.reload()
  await addExpense(page, '100.00')

  await expect(page.locator('.ledger-head')).toContainText('¥100.00')
  await expect(page.getByTestId('expense-item')).toHaveCount(4)
})