import { describe, expect, test } from 'vitest'
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_EDGE,
  MAX_IMAGES_PER_EXPENSE,
  MAX_VIDEOS_PER_EXPENSE,
  VIDEO_MAX_BYTES,
  canAddAttachment,
  classifyFile,
  countAttachments,
  extensionForMime,
  formatBytes,
  mimeForExtension,
  normalizeTags,
  pickImageMime,
  planImageCompression,
} from './media'

describe('图片压缩计划', () => {
  test('长边被压到上限以内，比例不变', () => {
    expect(planImageCompression(4000, 3000)).toEqual({ width: 1600, height: 1200, needsResize: true })
    expect(planImageCompression(3000, 4000)).toEqual({ width: 1200, height: 1600, needsResize: true })
  })

  test('小图不放大', () => {
    expect(planImageCompression(800, 600)).toEqual({ width: 800, height: 600, needsResize: false })
    expect(planImageCompression(1600, 1600)).toEqual({ width: 1600, height: 1600, needsResize: false })
  })

  test('刚好超一个像素也会被压，且长边正好等于上限', () => {
    const plan = planImageCompression(1601, 1000)
    expect(plan.needsResize).toBe(true)
    expect(Math.max(plan.width, plan.height)).toBe(IMAGE_MAX_EDGE)
  })

  test('上限是 SPEC 规定的 1600（这条挂了说明压缩被放开了）', () => {
    expect(IMAGE_MAX_EDGE).toBe(1600)
    expect(IMAGE_MAX_BYTES).toBe(800 * 1024)
    const plan = planImageCompression(9999, 9999)
    expect(plan.width).toBeLessThanOrEqual(IMAGE_MAX_EDGE)
    expect(plan.height).toBeLessThanOrEqual(IMAGE_MAX_EDGE)
  })

  test('极端长条图不会退化成 0 像素', () => {
    const plan = planImageCompression(10000, 3)
    expect(plan.width).toBeGreaterThanOrEqual(1)
    expect(plan.height).toBeGreaterThanOrEqual(1)
  })

  test('WebP 不支持时退回 JPEG', () => {
    expect(pickImageMime(true)).toBe('image/webp')
    expect(pickImageMime(false)).toBe('image/jpeg')
  })
})

describe('文件类型判定', () => {
  test('图片 / 视频 / 不支持', () => {
    expect(classifyFile('image/jpeg')).toBe('image')
    expect(classifyFile('image/heic')).toBe('image')
    expect(classifyFile('video/mp4')).toBe('video')
    expect(classifyFile('application/pdf')).toBe('unsupported')
  })
})

describe('附件数量与大小限制', () => {
  test('图片最多 9 张', () => {
    const nine = Array.from({ length: MAX_IMAGES_PER_EXPENSE }, () => ({ kind: 'image' as const, sizeBytes: 100 }))
    expect(canAddAttachment(nine.slice(0, 8), 'image', 100)).toEqual({ ok: true })
    expect(canAddAttachment(nine, 'image', 100)).toEqual({ ok: false, reason: '最多 9 张图片' })
  })

  test('视频最多 1 个且不超过 25MB', () => {
    expect(canAddAttachment([], 'video', VIDEO_MAX_BYTES)).toEqual({ ok: true })
    const over = canAddAttachment([], 'video', VIDEO_MAX_BYTES + 1)
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.reason).toContain('视频不能超过')
    expect(canAddAttachment([{ kind: 'video', sizeBytes: 100 }], 'video', 100)).toEqual({
      ok: false,
      reason: `最多 ${MAX_VIDEOS_PER_EXPENSE} 个视频`,
    })
  })

  test('统计各类附件数量', () => {
    expect(countAttachments([{ kind: 'image', sizeBytes: 1 }, { kind: 'video', sizeBytes: 1 }])).toEqual({
      images: 1,
      videos: 1,
    })
  })
})

describe('体积显示与文件后缀', () => {
  test('formatBytes 从小到大', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(-1)).toBe('0 B')
  })

  test('mime 与后缀互转能对上', () => {
    expect(extensionForMime('image/webp')).toBe('webp')
    expect(extensionForMime('video/quicktime')).toBe('mov')
    expect(mimeForExtension('webp')).toBe('image/webp')
    expect(mimeForExtension('mov')).toBe('video/quicktime')
    expect(mimeForExtension('xyz')).toBe('application/octet-stream')
  })
})

describe('标签清洗', () => {
  test('去 # 前缀、去空白、去重、限长限量', () => {
    expect(normalizeTags(['#吃饭', ' 吃饭 ', '购物'])).toEqual(['吃饭', '购物'])
    expect(normalizeTags(['', '   '])).toEqual([])
    expect(normalizeTags(['a'.repeat(30)])[0]).toHaveLength(12)
    expect(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(10)
  })
})