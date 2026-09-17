import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { createFakeGitHubState, handleGitHubRoute, readRemoteState, type FakeGitHubState } from './fakeGithub'
import { addExpense, expectToast, goto } from './utils'

const REPO = 'test/data'

/** 把 api.github.com 全部拦到本地假服务上：两台「设备」共用同一份 state */
async function attachFakeGitHub(context: BrowserContext, state: FakeGitHubState) {
  await context.route('https://api.github.com/**', (route) => handleGitHubRoute(state, route))
}

/** 在这台「设备」上把同步配好 */
async function configureSync(page: Page, state: FakeGitHubState) {
  await attachFakeGitHub(page.context(), state)
  await page.goto('/')
  await goto(page, '设置')
  await page.getByTestId('sync-repo').fill(REPO)
  await page.getByTestId('sync-token').fill('github_pat_fake_token')
  await page.getByTestId('sync-save').click()
  await expectToast(page, '同步设置存好了')
  await expect(page.getByTestId('sync-status')).toContainText('还没同步过')
}

test('两台设备连同一个仓库：手机记的账，电脑上能看到（含照片）', async ({ browser }) => {
  const state = createFakeGitHubState()

  // ---- 设备 A：手机 ----
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const phone = await phoneContext.newPage()
  await configureSync(phone, state)

  await phone.getByTestId('sync-test').click()
  await expectToast(phone, '连接正常')

  await goto(phone, '账本')
  await phone.getByRole('button', { name: '记一笔' }).click()
  await phone.getByTestId('amount-input').fill('128.50')
  await phone.getByTestId('note-input').fill('手机上买的')
  // 顺手带一张图，验证附件也走同步
  await phone.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 600
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ff9bb3'
    ctx.fillRect(0, 0, 800, 600)
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'receipt.png', { type: 'image/png' }))
    const input = document.querySelector('[data-testid="file-input"]') as HTMLInputElement
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(phone.getByTestId('pending-attachment')).toHaveCount(1)
  await phone.getByTestId('save-expense').click()
  await expect(phone.getByTestId('add-sheet')).toBeHidden()

  await goto(phone, '设置')
  await phone.getByTestId('sync-now').click()
  await expectToast(phone, '同步完成')

  // 云端真的收到了
  const remote = readRemoteState(state)
  expect(remote).not.toBeNull()
  const remoteExpenses = remote?.expenses as Array<{ amountCents: number }>
  expect(remoteExpenses[0].amountCents).toBe(12850)
  expect([...state.files.keys()].some((path) => path.startsWith('media/'))).toBe(true)

  // ---- 设备 B：电脑（全新上下文＝全新设备）----
  const computerContext = await browser.newContext()
  const computer = await computerContext.newPage()
  await configureSync(computer, state)

  await computer.getByTestId('sync-now').click()
  await expectToast(computer, '拉取')

  await expect(computer.getByTestId('sync-status')).toContainText('拉取 1 笔')
  await goto(computer, '账本')
  await expect(computer.getByTestId('expense-item')).toHaveCount(1)
  await expect(computer.getByTestId('expense-item')).toContainText('¥128.50')
  await expect(computer.getByTestId('expense-item')).toContainText('手机上买的')
  // 图片也从云端下回来了
  await expect(computer.getByTestId('attachment-thumb')).toHaveCount(1)

  await phoneContext.close()
  await computerContext.close()
})

test('手机删掉的记录，电脑同步后也没了（不会被电脑的旧副本推回来）', async ({ browser }) => {
  const state = createFakeGitHubState()
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const computerContext = await browser.newContext()

  const phone = await phoneContext.newPage()
  await configureSync(phone, state)
  await goto(phone, '账本')
  await addExpense(phone, '66.00', { note: '待会儿要删' })
  await goto(phone, '设置')
  await phone.getByTestId('sync-now').click()
  await expectToast(phone, '同步完成')

  const computer = await computerContext.newPage()
  await configureSync(computer, state)
  await computer.getByTestId('sync-now').click()
  await goto(computer, '账本')
  await expect(computer.getByTestId('expense-item')).toHaveCount(1)

  // 手机上删掉
  await goto(phone, '账本')
  await phone.getByTestId('expense-item').click()
  await phone.getByTestId('delete-expense').click()
  await phone.getByTestId('confirm-delete').click()
  await expect(phone.getByTestId('empty-ledger')).toBeVisible()
  await goto(phone, '设置')
  await phone.getByTestId('sync-now').click()
  await expectToast(phone, '同步完成')

  // 电脑同步：本地这条要被删掉（注意要先回设置页，同步按钮在那儿）
  await goto(computer, '设置')
  await computer.getByTestId('sync-now').click()
  await expectToast(computer, '同步完成')
  await goto(computer, '账本')
  await expect(computer.getByTestId('empty-ledger')).toBeVisible()

  const remote = readRemoteState(state)
  expect(remote?.expenses).toEqual([])

  await phoneContext.close()
  await computerContext.close()
})

test('两边各记各的，同步一次后两台都能看到两条', async ({ browser }) => {
  const state = createFakeGitHubState()
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const computerContext = await browser.newContext()

  const phone = await phoneContext.newPage()
  await configureSync(phone, state)
  await goto(phone, '账本')
  await addExpense(phone, '10.00', { note: '手机记的' })

  const computer = await computerContext.newPage()
  await configureSync(computer, state)
  await goto(computer, '账本')
  await addExpense(computer, '20.00', { note: '电脑记的' })

  await goto(phone, '设置')
  await phone.getByTestId('sync-now').click()
  await expectToast(phone, '同步完成')

  await goto(computer, '设置')
  await computer.getByTestId('sync-now').click()
  await expectToast(computer, '同步完成')

  await phone.getByTestId('sync-now').click()
  await expectToast(phone, '同步完成')

  await goto(phone, '账本')
  await expect(phone.getByTestId('expense-item')).toHaveCount(2)
  await goto(computer, '账本')
  await expect(computer.getByTestId('expense-item')).toHaveCount(2)

  await phoneContext.close()
  await computerContext.close()
})

test('打开自动同步：勾上之后记完一笔会自己传上去', async ({ browser }) => {
  const state = createFakeGitHubState()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const page = await context.newPage()
  await configureSync(page, state)

  await page.getByTestId('sync-enabled').check()
  await expect(page.getByTestId('sync-enabled')).toBeChecked()

  await goto(page, '账本')
  await addExpense(page, '33.30', { note: '自动同步' })

  // 攒 3 秒才推，等云端真的收到
  await expect
    .poll(async () => (readRemoteState(state)?.expenses as unknown[] | undefined)?.length ?? 0, { timeout: 15000 })
    .toBe(1)

  await goto(page, '设置')
  await expect(page.getByTestId('sync-status')).toContainText('上次同步')

  await context.close()
})

test('没配 token 时同步按钮给出明确提示，不静默失败', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  await goto(page, '设置')

  await page.getByTestId('sync-now').click()
  await expect(page.getByTestId('sync-status')).toContainText('还没配好')

  await context.close()
})