import { describe, expect, test } from 'vitest'
import { describeRejections, screenFiles, totalBytes } from './upload'
import { MAX_IMAGES_PER_EXPENSE, VIDEO_MAX_BYTES } from './media'

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type })
}

describe('选文件时的准入判定', () => {
  test('图片和视频都收，其他类型给原因', () => {
    const { prepared, rejections } = screenFiles([file('a.jpg', 'image/jpeg', 100), file('b.pdf', 'application/pdf', 10)], [])
    expect(prepared).toHaveLength(1)
    expect(prepared[0].kind).toBe('image')
    expect(rejections).toEqual([{ name: 'b.pdf', reason: '只支持图片和视频' }])
  })

  test('超过 9 张的部分要被拒绝，并且说清是哪张', () => {
    const existing = Array.from({ length: MAX_IMAGES_PER_EXPENSE }, () => ({ kind: 'image' as const, sizeBytes: 10 }))
    const { prepared, rejections } = screenFiles([file('extra.png', 'image/png', 10)], existing)
    expect(prepared).toHaveLength(0)
    expect(rejections[0]).toEqual({ name: 'extra.png', reason: '最多 9 张图片' })
  })

  test('视频超过 25MB 被拒绝，理由里带体积', () => {
    const { prepared, rejections } = screenFiles([file('big.mp4', 'video/mp4', VIDEO_MAX_BYTES + 1)], [])
    expect(prepared).toHaveLength(0)
    expect(rejections[0].reason).toContain('视频不能超过')
  })

  test('一次选多个时，能收的先收，不能收的逐条报告（不许静默丢）', () => {
    const { prepared, rejections } = screenFiles(
      [file('ok1.jpg', 'image/jpeg', 10), file('bad.txt', 'text/plain', 10), file('ok2.png', 'image/png', 10)],
      [],
    )
    expect(prepared.map((p) => p.file.name)).toEqual(['ok1.jpg', 'ok2.png'])
    expect(rejections).toHaveLength(1)
  })

  test('空选择什么都不做', () => {
    expect(screenFiles([], [])).toEqual({ prepared: [], rejections: [] })
  })
})

describe('拒绝理由文案', () => {
  test('一条时直接说，两条时用分号连', () => {
    expect(describeRejections([{ name: 'a', reason: '太大' }])).toBe('a：太大')
    expect(describeRejections([{ name: 'a', reason: '太大' }, { name: 'b', reason: '不支持' }])).toBe('a：太大；b：不支持')
  })

  test('超过三条时只说前两条并给出剩余数量', () => {
    const text = describeRejections([
      { name: 'a', reason: '1' },
      { name: 'b', reason: '2' },
      { name: 'c', reason: '3' },
      { name: 'd', reason: '4' },
    ])
    expect(text).toContain('还有 2 个被跳过')
  })

  test('没有拒绝时是空串', () => {
    expect(describeRejections([])).toBe('')
  })

  test('总体积文案', () => {
    expect(totalBytes([{ sizeBytes: 1024 }, { sizeBytes: 1024 }])).toBe('2.0 KB')
  })
})