import { expect, test } from '@playwright/test'

test('底部导航：四个页面能互相跳转', async ({ page }) => {
  await page.goto('/')

  // 首页（账本）
  await expect(page.getByTestId('page-ledger')).toBeVisible()

  await page.getByRole('link', { name: /统计/ }).click()
  await expect(page.getByTestId('page-stats')).toBeVisible()
  await expect(page).toHaveURL(/#\/stats$/)

  await page.getByRole('link', { name: /预算/ }).click()
  await expect(page.getByTestId('page-budget')).toBeVisible()

  await page.getByRole('link', { name: /设置/ }).click()
  await expect(page.getByTestId('page-settings')).toBeVisible()

  await page.getByRole('link', { name: /账本/ }).click()
  await expect(page.getByTestId('page-ledger')).toBeVisible()
})

test('记一笔入口能打开弹层', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '记一笔' }).click()
  await expect(page.getByTestId('add-sheet')).toBeVisible()
})

test('刷新后仍停在当前页面（hash 路由在子路径下不 404）', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /统计/ }).click()
  await expect(page.getByTestId('page-stats')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('page-stats')).toBeVisible()
})