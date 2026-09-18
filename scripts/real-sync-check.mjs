/**
 * 真链路校验：真浏览器 + 真 GitHub + 真图片，两台设备走一遍完整往返。
 *
 * 为什么需要它：引擎的单测/E2E 用的都是假 GitHub，探针只验接口形状。
 * 2026-09-18 那个「图片同步成 0 字节」的 bug 就是在这种组合下漏掉的——
 * 每一环的测试都绿，合起来是坏的。这个脚本专门堵这条缝。
 *
 * 用法：
 *   GH_TOKEN=$(gh auth token) node scripts/real-sync-check.mjs [owner/repo]
 * 默认仓库：qqtang-code/sync-probe-scratch（一次性仓库）
 * 默认站点：线上 https://qqtang-code.github.io/cute-ledger/（用 SITE= 可以换成本地预览）
 *
 * 安全：只允许跑在名字里带 scratch / probe 的仓库上，且结束时会把该仓库清空。
 */
import { chromium } from '@playwright/test'

const API = 'https://api.github.com'
const TOKEN = process.env.GH_TOKEN
const REPO = process.argv[2] ?? 'qqtang-code/sync-probe-scratch'
const SITE = process.env.SITE ?? 'https://qqtang-code.github.io/cute-ledger/'
const BRANCH = 'main'

if (!TOKEN) {
  console.error('缺少 GH_TOKEN。用法：GH_TOKEN=$(gh auth token) node scripts/real-sync-check.mjs')
  process.exit(1)
}
// 这个脚本会把仓库清空，所以只认一次性仓库
if (!/(scratch|probe)/i.test(REPO)) {
  console.error(`拒绝运行：${REPO} 看起来不是一次性仓库。这个脚本会把目标仓库清空，只在 scratch/probe 仓库上跑。`)
  process.exit(1)
}

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` —— ${detail}` : ''}`)
  if (!ok) failures += 1
}

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

/** 把目标仓库清空（它是一次性仓库，专门给这类校验用） */
async function emptyRepo() {
  let listing = []
  try {
    listing = (await api('GET', `/repos/${REPO}/git/trees/${BRANCH}?recursive=1`)).tree ?? []
  } catch {
    return
  }
  for (const entry of listing.filter((item) => item.type === 'blob')) {
    const file = await api('GET', `/repos/${REPO}/contents/${entry.path}?ref=${BRANCH}`)
    await api('DELETE', `/repos/${REPO}/contents/${entry.path}`, {
      message: `真链路校验：清理 ${entry.path}`,
      sha: file.sha,
      branch: BRANCH,
    })
  }
}

/** 在这台「设备」上把同步配好 */
async function configureSync(page, repo) {
  await page.goto(SITE)
  await page.getByRole('link', { name: /设置/ }).click()
  await page.getByTestId('sync-repo').fill(repo)
  await page.getByTestId('sync-token').fill(TOKEN)
  await page.getByTestId('sync-save').click()
  await page.getByTestId('sync-status').waitFor({ state: 'visible' })
}

/** 记一笔，带一张真的会被压缩上传的图 */
async function recordWithImage(page, amount) {
  await page.getByRole('link', { name: /账本/ }).click()
  await page.getByRole('button', { name: '记一笔' }).click()
  await page.getByTestId('amount-input').fill(amount)
  await page.getByTestId('note-input').fill('真链路校验')
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 700
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#7ec8e3'
    ctx.fillRect(0, 0, 900, 700)
    ctx.fillStyle = '#fff'
    ctx.font = '60px sans-serif'
    ctx.fillText('REAL', 40, 120)
    const blob = await new Promise((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'))
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'real-receipt.png', { type: 'image/png' }))
    const input = document.querySelector('[data-testid="file-input"]')
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.getByTestId('pending-attachment').waitFor({ state: 'visible' })
  await page.getByTestId('save-expense').click()
  await page.getByTestId('add-sheet').waitFor({ state: 'hidden' })
}

/**
 * 等出现一条匹配 pattern 的 toast，返回所有 toast 的文字。
 * 注意：每条 toast 里都带一个「好」按钮，textContent 会把按钮文字也带上，所以用包含匹配。
 * 也不能只看「最新那条」——上一条（比如「同步设置存好了」）还在屏幕上，会读到它。
 */
async function waitToastMatching(page, pattern, timeout = 90000) {
  const started = Date.now()
  let seen = ''
  while (Date.now() - started < timeout) {
    const texts = await page.getByTestId('toast').allTextContents()
    seen = texts.join(' | ')
    const hit = texts.find((text) => pattern.test(text))
    if (hit) return hit.trim()
    await page.waitForTimeout(250)
  }
  throw new Error(`等 toast 超时（期望匹配 ${pattern}），屏幕上是：${seen || '（一条都没有）'}`)
}

/** 读出这台设备 IndexedDB 里所有附件的字节数 */
async function attachmentSizes(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('cute-ledger')
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction('attachments', 'readonly')
    const rows = await new Promise((resolve, reject) => {
      const all = tx.objectStore('attachments').getAll()
      all.onsuccess = () => resolve(all.result)
      all.onerror = () => reject(all.error)
    })
    db.close()
    return rows.map((row) => row.blob.size)
  })
}

let browser
try {
  console.log(`真链路校验\n  站点：${SITE}\n  仓库：${REPO}（分支 ${BRANCH}）\n`)

  const repo = await api('GET', `/repos/${REPO}`)
  check('仓库可读', repo.full_name === REPO, `${repo.full_name} private=${repo.private}`)
  await emptyRepo()
  console.log('  （已把仓库清空，模拟「全新仓库第一次同步」——这正是之前会 409 报错的那条路径）\n')

  browser = await chromium.launch({ channel: 'chrome' })

  // ---- 设备 A：手机 ----
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const phone = await phoneContext.newPage()
  const phoneErrors = []
  phone.on('pageerror', (error) => phoneErrors.push(error.message))
  await configureSync(phone, REPO)
  await phone.getByTestId('sync-test').click()
  const testToast = await waitToastMatching(phone, /连接正常|没有写权限|失败|错误/)
  check('手机上测试连接通过（空仓库也要能连）', /连接正常/.test(testToast), testToast)

  await recordWithImage(phone, '36.50')
  const phoneSizes = await attachmentSizes(phone)
  check('照片在手机本机已存好', phoneSizes.length === 1 && phoneSizes[0] > 0, `${phoneSizes[0]} 字节`)

  await phone.getByRole('link', { name: /设置/ }).click()
  await phone.getByTestId('sync-now').click()
  const pushToast = await waitToastMatching(phone, /同步完成/)
  check('手机同步成功（含照片上传）', /同步完成/.test(pushToast) && !/失败|错误|没下下来/.test(pushToast), pushToast)
  check('手机上没有页面级报错', phoneErrors.length === 0, phoneErrors.join(' | ').slice(0, 120))

  // ---- 云端真有东西 ----
  const listing = (await api('GET', `/repos/${REPO}/git/trees/${BRANCH}?recursive=1`)).tree ?? []
  const stateEntry = listing.find((entry) => entry.path === 'state.json')
  const mediaEntries = listing.filter((entry) => entry.path.startsWith('media/'))
  check('云端有 state.json', Boolean(stateEntry), `${stateEntry?.size ?? 0} 字节`)
  check('云端有那个附件文件', mediaEntries.length === 1, `${mediaEntries[0]?.path} ${mediaEntries[0]?.size ?? 0} 字节`)
  check('云端附件不是空的', (mediaEntries[0]?.size ?? 0) > 100, `${mediaEntries[0]?.size ?? 0} 字节`)
  const cloudState = JSON.parse(
    Buffer.from((await api('GET', `/repos/${REPO}/contents/state.json?ref=${BRANCH}`)).content, 'base64').toString('utf8'),
  )
  check('云端那笔账金额正确', cloudState.expenses?.[0]?.amountCents === 3650, `¥${(cloudState.expenses?.[0]?.amountCents ?? 0) / 100}`)
  const cloudSize = mediaEntries[0]?.size ?? 0

  // ---- 设备 B：电脑（全新上下文＝另一台设备）----
  const computerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const computer = await computerContext.newPage()
  const computerErrors = []
  computer.on('pageerror', (error) => computerErrors.push(error.message))
  await configureSync(computer, REPO)
  await computer.getByTestId('sync-now').click()
  const pullToast = await waitToastMatching(computer, /同步完成/)
  check('电脑同步成功', /同步完成/.test(pullToast) && !/失败|错误|没下下来/.test(pullToast), pullToast)

  await computer.getByRole('link', { name: /账本/ }).click()
  await computer.getByTestId('expense-item').first().waitFor({ state: 'visible' })
  const itemText = await computer.getByTestId('expense-item').first().textContent()
  check('电脑上看到了那笔账', /¥36\.50/.test(itemText ?? ''), itemText?.trim().slice(0, 60))

  const computerSizes = await attachmentSizes(computer)
  check('照片下到电脑上了，不是 0 字节', computerSizes.length === 1 && computerSizes[0] > 0, `${computerSizes[0]} 字节`)
  check(
    '电脑上的字节数和云端文件一致（逐字节下来，没被截断）',
    computerSizes[0] === cloudSize,
    `本机 ${computerSizes[0]} / 云端 ${cloudSize}`,
  )

  const image = computer.getByTestId('attachment-thumb').locator('img').first()
  await image.waitFor({ state: 'visible' })
  const naturalWidth = await image.evaluate(async (node) => {
    if (!node.complete) await new Promise((resolve) => node.addEventListener('load', resolve, { once: true }))
    return node.naturalWidth
  })
  check('浏览器真把像素画出来了（0 字节的壳子这里会是 0）', naturalWidth > 0, `naturalWidth=${naturalWidth}`)
  check('电脑上没有页面级报错', computerErrors.length === 0, computerErrors.join(' | ').slice(0, 120))

  await phoneContext.close()
  await computerContext.close()
  await emptyRepo()
  console.log('\n（收尾：仓库已清空）')
} catch (error) {
  console.error(`\n✗ 真链路校验中断：${error.message}`)
  failures += 1
} finally {
  await browser?.close()
}

if (failures === 0) console.log('\n全部通过：真浏览器 ↔ 真 GitHub ↔ 真图片，两台设备往返一致。')
else console.log(`\n${failures} 项没过。`)
process.exit(failures === 0 ? 0 : 1)