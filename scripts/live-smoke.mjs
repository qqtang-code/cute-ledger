/**
 * 部署后冒烟：用真浏览器以手机视口打开线上地址，确认能加载、能记账、能刷新还在。
 * 用法：node scripts/live-smoke.mjs
 * （不放进 e2e/ 是因为它打的是线上地址、要联网，不适合每次跑测试都执行）
 */
import { chromium } from '@playwright/test'

const URL = process.env.LIVE_URL ?? 'https://qqtang-code.github.io/cute-ledger/'

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
})
const page = await context.newPage()

const problems = []
page.on('pageerror', (error) => problems.push(`页面报错：${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`控制台报错：${message.text()}`)
})

function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` —— ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

try {
  const response = await page.goto(URL, { waitUntil: 'domcontentloaded' })
  check('首页返回 200', response?.status() === 200, `HTTP ${response?.status()}`)
  check('标题正确', (await page.title()).includes('记账'), await page.title())

  await page.getByTestId('page-ledger').waitFor({ timeout: 20000 })
  check('账本页渲染出来了', true)

  const amount = (Math.floor(Math.random() * 9000) + 1000) / 100
  await page.getByRole('button', { name: '记一笔' }).click()
  await page.getByTestId('amount-input').fill(String(amount))
  await page.getByTestId('note-input').fill('线上冒烟')
  await page.getByTestId('save-expense').click()
  await page.getByTestId('expense-item').first().waitFor({ timeout: 15000 })
  const text = await page.getByTestId('expense-item').first().innerText()
  check('能记一笔并出现在列表', text.includes('线上冒烟') && text.includes('¥'), text.replace(/\n/g, ' '))

  await page.reload()
  await page.getByTestId('expense-item').first().waitFor({ timeout: 15000 })
  const afterReload = await page.getByTestId('expense-item').first().innerText()
  check('刷新后记录还在（IndexedDB 生效）', afterReload.includes('线上冒烟'))

  await page.getByRole('link', { name: /统计/ }).click()
  await page.getByTestId('stats-cards').waitFor({ timeout: 15000 })
  const cards = await page.getByTestId('stats-cards').innerText()
  check('统计页能打开且不是 NaN', !cards.includes('NaN'), cards.replace(/\n/g, ' '))

  const manifest = await context.request.get(new globalThis.URL('manifest.webmanifest', URL).href)
  check('PWA manifest 可取', manifest.status() === 200, `HTTP ${manifest.status()}`)

  check('没有页面级报错', problems.length === 0, problems.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}