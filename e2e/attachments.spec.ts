import { expect, test, type Page } from '@playwright/test'

/** 在页面里造一张大图塞进文件选择框（走真实的上传路径，不 mock 压缩） */
async function uploadGeneratedImage(page: Page, width: number, height: number) {
  await page.evaluate(
    async ({ width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      // 画满噪声：纯色图压缩后太小，验证不出「压缩真的做了」
      for (let i = 0; i < 24000; i++) {
        ctx.fillStyle = `hsl(${(i * 37) % 360}, 70%, ${40 + (i % 40)}%)`
        ctx.fillRect((i * 137) % width, (i * 271) % height, 14, 14)
      }
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
      )
      const file = new File([blob], 'big-photo.png', { type: 'image/png' })
      const transfer = new DataTransfer()
      transfer.items.add(file)
      const input = document.querySelector('[data-testid="file-input"]') as HTMLInputElement
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    { width, height },
  )
}

function parseCaption(text: string): { width: number; height: number; kb: number } {
  const dims = text.match(/(\d+)×(\d+)/)
  const kb = text.match(/([\d.]+)\s*KB/)
  if (!dims) throw new Error(`尺寸没解析出来：${text}`)
  return {
    width: Number(dims[1]),
    height: Number(dims[2]),
    kb: kb ? Number(kb[1]) : 0,
  }
}

test('大图先压缩再入库：长边 ≤1600、体积 ≤800KB（R5）', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '记一笔' }).click()
  await page.getByTestId('amount-input').fill('10.00')

  await uploadGeneratedImage(page, 3200, 2400)

  const pending = page.getByTestId('pending-attachment')
  await expect(pending).toHaveCount(1)
  const caption = (await pending.locator('.picker__caption').textContent()) ?? ''
  const parsed = parseCaption(caption)

  expect(parsed.width).toBeLessThanOrEqual(1600)
  expect(parsed.height).toBeLessThanOrEqual(1600)
  // 长边正好压到 1600（等比缩放到上限，不是随便缩小）
  expect(Math.max(parsed.width, parsed.height)).toBe(1600)
  expect(parsed.kb).toBeLessThanOrEqual(800)

  await page.getByTestId('save-expense').click()
  await expect(page.getByTestId('add-sheet')).toBeHidden()
  await expect(page.getByTestId('attachment-thumb')).toHaveCount(1)
})

test('附件存进库后刷新还在，详情里能看（R5）', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '记一笔' }).click()
  await page.getByTestId('amount-input').fill('23.00')
  await uploadGeneratedImage(page, 2400, 1600)
  await expect(page.getByTestId('pending-attachment')).toHaveCount(1)
  await page.getByTestId('save-expense').click()

  // 必须等保存真的写完（弹层自己关掉）再刷新，否则刷新会打断写库
  await expect(page.getByTestId('add-sheet')).toBeHidden()
  await expect(page.getByTestId('expense-item')).toHaveCount(1)

  await page.reload()
  await expect(page.getByTestId('expense-item')).toHaveCount(1)
  await expect(page.getByTestId('attachment-thumb')).toHaveCount(1)

  await page.getByTestId('expense-item').click()
  const detail = page.getByTestId('detail-sheet')
  await expect(detail).toBeVisible()
  await expect(detail.getByTestId('attachment-thumb')).toHaveCount(1)

  await detail.getByTestId('attachment-thumb').click()
  await expect(page.getByTestId('image-viewer')).toBeVisible()
  await expect(page.getByTestId('image-viewer').locator('img')).toBeVisible()
})

test('不支持的格式会被拒绝并说明原因，不静默丢弃（R5）', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '记一笔' }).click()

  await page.evaluate(() => {
    const file = new File([new Uint8Array([1, 2, 3])], 'note.pdf', { type: 'application/pdf' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    const input = document.querySelector('[data-testid="file-input"]') as HTMLInputElement
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })

  await expect(page.getByTestId('toast')).toContainText('note.pdf')
  await expect(page.getByTestId('toast')).toContainText('只支持图片和视频')
  await expect(page.getByTestId('pending-attachment')).toHaveCount(0)
})