import { expect, test } from '@playwright/test'
import { addExpense, expectToast, goto } from './utils'

test('统计页：合计、分类占比、每日趋势都对得上（R6）', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, '30.00', { category: 'cat-food' })
  await addExpense(page, '70.00', { category: 'cat-fun' })

  await goto(page, '统计')
  await expect(page.getByTestId('stats-cards')).toContainText('¥100.00')
  await expect(page.getByTestId('stat-count')).toHaveText('2')

  // 两个分类 → 两段弧 + 两行图例，占比 30% / 70%
  await expect(page.getByTestId('donut-slice')).toHaveCount(2)
  await expect(page.getByTestId('legend-row')).toHaveCount(2)
  await expect(page.getByTestId('stats-donut')).toContainText('30%')
  await expect(page.getByTestId('stats-donut')).toContainText('70%')

  await expect(page.getByTestId('bar').first()).toBeVisible()
  await expect(page.getByTestId('stats-busy')).toContainText('1 天花钱')
})

test('统计页空数据不出现 NaN（R6）', async ({ page }) => {
  await page.goto('/')
  await goto(page, '统计')
  await expect(page.getByTestId('stats-cards')).toContainText('¥0.00')
  await expect(page.getByTestId('donut-empty')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('NaN')
  await expect(page.locator('body')).not.toContainText('Infinity')
})

test('预算：设了之后有进度条，超了变红并提示超支（R7）', async ({ page }) => {
  await page.goto('/')
  await goto(page, '预算')

  await page.getByTestId('budget-input').fill('100')
  await page.getByTestId('save-budget').click()
  await expect(page.getByTestId('budget-bar')).toHaveAttribute('data-level', 'ok')

  await goto(page, '账本')
  await page.getByRole('button', { name: '记一笔' }).click()
  await page.getByTestId('amount-input').fill('120.00')
  await page.getByTestId('save-expense').click()
  // 保存成功的提示里要顺带提醒超支，但不打断保存（R7）
  await expectToast(page, '本月已超支 ¥20.00')
  await expect(page.getByTestId('expense-item')).toHaveCount(1)

  await goto(page, '预算')
  await expect(page.getByTestId('budget-bar')).toHaveAttribute('data-level', 'over')
  await expect(page.getByTestId('budget-status')).toContainText('已超支 ¥20.00')
})

test('分类：能新建、能选中、有流水时删除会自动归档（R8）', async ({ page }) => {
  await page.goto('/')
  await goto(page, '设置')

  await page.getByTestId('new-category').click()
  await page.getByTestId('new-category-name').fill('奶茶')
  await page.getByTestId('new-category-save').click()
  await expect(page.getByTestId('category-manager')).toContainText('奶茶')

  await goto(page, '账本')
  await page.getByRole('button', { name: '记一笔' }).click()
  const custom = page.locator('.chip', { hasText: '奶茶' })
  await custom.click()
  await page.getByTestId('amount-input').fill('18.00')
  await page.getByTestId('save-expense').click()
  await expect(page.getByTestId('expense-item')).toContainText('奶茶')

  await goto(page, '设置')
  const rowId = await page
    .locator('[data-testid^="category-row-"]', { hasText: '奶茶' })
    .getAttribute('data-testid')
  const id = (rowId ?? '').replace('category-row-', '')
  await page.getByTestId(`category-delete-${id}`).click()

  await expectToast(page, '已改为归档')
  await expect(page.getByTestId('category-manager')).toContainText('已归档')
})

test('设置：主题与货币符号能改、刷新后还在（R9）', async ({ page }) => {
  await page.goto('/')
  await goto(page, '设置')

  await page.getByTestId('theme-mint').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mint')

  await page.getByTestId('currency-$').click()
  await page.getByTestId('mode-dark').click()
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mint')
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')

  await goto(page, '账本')
  await addExpense(page, '5.50')
  await expect(page.getByTestId('expense-item')).toContainText('$5.50')
})

test('清空数据要输入「删除」才生效（R9）', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, '10.00')
  await goto(page, '设置')

  await page.getByTestId('wipe-input').fill('删')
  await page.getByTestId('wipe-data').click()
  await expectToast(page, '要输入「删除」')

  await page.getByTestId('wipe-input').fill('删除')
  await page.getByTestId('wipe-data').click()

  await goto(page, '账本')
  await expect(page.getByTestId('empty-ledger')).toBeVisible()
})

test('备份闭环：导出 zip → 清空 → 导入回来，数据一条不少（R10）', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, '88.00', { note: '备份测试' })
  await goto(page, '设置')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-zip').click(),
  ])
  const backupPath = await download.path()
  expect(backupPath).toBeTruthy()
  expect(download.suggestedFilename()).toContain('.zip')

  // 清空
  await page.getByTestId('wipe-input').fill('删除')
  await page.getByTestId('wipe-data').click()
  await goto(page, '账本')
  await expect(page.getByTestId('empty-ledger')).toBeVisible()

  // 导入回来
  await goto(page, '设置')
  await page.getByTestId('backup-file-input').setInputFiles(backupPath!)
  await expect(page.getByTestId('import-preview')).toContainText('1 笔流水')
  await page.getByTestId('import-merge').click()
  await expectToast(page, '导入完成：1 笔')

  await goto(page, '账本')
  await expect(page.getByTestId('expense-item')).toHaveCount(1)
  await expect(page.getByTestId('expense-item')).toContainText('¥88.00')
  await expect(page.getByTestId('expense-item')).toContainText('备份测试')
})

test('CSV 导出的是能打开的表格（R10）', async ({ page }) => {
  await page.goto('/')
  await addExpense(page, '66.60', { note: 'CSV 测试' })
  await goto(page, '设置')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-csv').click(),
  ])
  expect(download.suggestedFilename()).toContain('.csv')
  expect(await download.path()).toBeTruthy()
})

test('PWA：manifest 齐全、Service Worker 注册成功（R11）', async ({ page, request }) => {
  const manifestResponse = await request.get('http://localhost:4173/cute-ledger/manifest.webmanifest')
  expect(manifestResponse.status()).toBe(200)
  const manifest = await manifestResponse.json()
  expect(manifest.name).toBe('可爱记账本')
  expect(manifest.start_url).toBe('/cute-ledger/')
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  )

  const swResponse = await request.get('http://localhost:4173/cute-ledger/sw.js')
  expect(swResponse.status()).toBe(200)

  await page.goto('/')
  const controlled = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    return registration.active !== null
  })
  expect(controlled).toBe(true)
})

test('断网后仍能打开账本并记一笔（R11）', async ({ page, context }) => {
  await page.goto('/')
  await addExpense(page, '11.00', { note: '联网时记的' })

  // 等 Service Worker 接管页面，缓存才会命中
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready
    return navigator.serviceWorker.controller !== null
  })

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByTestId('page-ledger')).toBeVisible()
  await expect(page.getByTestId('expense-item')).toContainText('联网时记的')

  await addExpense(page, '22.00', { note: '断网时记的' })
  await expect(page.getByTestId('expense-item').first()).toContainText('断网时记的')

  await context.setOffline(false)
  await page.reload()
  await expect(page.getByTestId('expense-item')).toHaveCount(2)
})