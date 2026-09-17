import { describe, expect, test } from 'vitest'
import { BUDGET_WARN_RATIO, budgetLevel, budgetLevelLabel, budgetProgress } from './budget'

describe('预算档位', () => {
  test('79% 绿、80% 黄、100% 黄、101% 红', () => {
    expect(budgetLevel(0.79)).toBe('ok')
    expect(budgetLevel(BUDGET_WARN_RATIO)).toBe('warn')
    expect(budgetLevel(1)).toBe('warn')
    expect(budgetLevel(1.01)).toBe('over')
  })

  test('档位文案', () => {
    expect(budgetLevelLabel('ok')).toBe('充裕')
    expect(budgetLevelLabel('warn')).toBe('接近上限')
    expect(budgetLevelLabel('over')).toBe('超支')
  })
})

describe('预算进度', () => {
  test('花了一半：进度 0.5、剩余一半、没超支', () => {
    const p = budgetProgress(50_000, 100_000)
    expect(p).toMatchObject({ hasBudget: true, ratio: 0.5, level: 'ok', remainingCents: 50_000, overCents: 0 })
    expect(p.barRatio).toBe(0.5)
  })

  test('超支：overCents 是超出的金额，进度条夹在 1', () => {
    const p = budgetProgress(130_000, 100_000)
    expect(p.level).toBe('over')
    expect(p.overCents).toBe(30_000)
    expect(p.remainingCents).toBe(0)
    expect(p.barRatio).toBe(1)
    expect(p.ratio).toBeCloseTo(1.3, 10)
  })

  test('没设预算时不给 NaN / Infinity', () => {
    const p = budgetProgress(12_345, 0)
    expect(p.hasBudget).toBe(false)
    expect(p.ratio).toBe(0)
    expect(p.barRatio).toBe(0)
    expect(p.level).toBe('ok')
    expect(p.remainingCents).toBe(0)
    expect(p.overCents).toBe(0)
  })

  test('正好花完算「接近上限」而不是超支', () => {
    const p = budgetProgress(100_000, 100_000)
    expect(p.level).toBe('warn')
    expect(p.overCents).toBe(0)
    expect(p.remainingCents).toBe(0)
  })

  test('小额预算也精确（分制不丢精度）', () => {
    const p = budgetProgress(1, 333)
    expect(p.overCents).toBe(0)
    expect(p.remainingCents).toBe(332)
    expect(p.level).toBe('ok')
  })
})