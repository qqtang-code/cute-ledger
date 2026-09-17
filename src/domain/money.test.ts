import { describe, expect, test } from 'vitest'
import {
  MAX_AMOUNT_CENTS,
  centsFromYuan,
  centsToPlainString,
  formatCents,
  parseAmountToCents,
  sumCents,
  sumExpenseCents,
  validateAmountCents,
  yuanFromCents,
} from './money'

describe('parseAmountToCents', () => {
  test('整数与两位小数都能解析成分', () => {
    expect(parseAmountToCents('12')).toEqual({ ok: true, cents: 1200 })
    expect(parseAmountToCents('12.3')).toEqual({ ok: true, cents: 1230 })
    expect(parseAmountToCents('12.34')).toEqual({ ok: true, cents: 1234 })
    expect(parseAmountToCents('0.01')).toEqual({ ok: true, cents: 1 })
  })

  test('容忍千分位、货币符号、空格和全角数字（中文输入法）', () => {
    expect(parseAmountToCents('1,234.56')).toEqual({ ok: true, cents: 123456 })
    expect(parseAmountToCents('¥12.50')).toEqual({ ok: true, cents: 1250 })
    expect(parseAmountToCents(' 12.50 ')).toEqual({ ok: true, cents: 1250 })
    expect(parseAmountToCents('１２．５')).toEqual({ ok: true, cents: 1250 })
  })

  test('超过两位小数、空、负数、字母一律拒绝并给出原因', () => {
    expect(parseAmountToCents('12.345')).toEqual({ ok: false, reason: '最多两位小数' })
    expect(parseAmountToCents('')).toEqual({ ok: false, reason: '请输入金额' })
    expect(parseAmountToCents('-5')).toEqual({ ok: false, reason: '金额只能是数字' })
    expect(parseAmountToCents('abc')).toEqual({ ok: false, reason: '金额只能是数字' })
    expect(parseAmountToCents('.')).toEqual({ ok: false, reason: '金额只能是数字' })
  })

  test('小数位不足两位时按分补零，不走浮点', () => {
    expect(parseAmountToCents('0.1')).toEqual({ ok: true, cents: 10 })
    expect(parseAmountToCents('0.2')).toEqual({ ok: true, cents: 20 })
    expect(parseAmountToCents('12.')).toEqual({ ok: true, cents: 1200 })
  })
})

describe('validateAmountCents', () => {
  test('0 和负数被拒，正数通过', () => {
    expect(validateAmountCents(0)).toBe('金额要大于 0')
    expect(validateAmountCents(-1)).toBe('金额要大于 0')
    expect(validateAmountCents(1)).toBeNull()
  })

  test('超过上限被拒，正好等于上限通过', () => {
    expect(validateAmountCents(MAX_AMOUNT_CENTS)).toBeNull()
    expect(validateAmountCents(MAX_AMOUNT_CENTS + 1)).toContain('上限')
  })

  test('非整数被拒（钱必须是整数分）', () => {
    expect(validateAmountCents(12.5)).toBe('金额不合法')
  })
})

describe('formatCents', () => {
  test('两位小数 + 千分位 + 自定义符号', () => {
    expect(formatCents(1250)).toBe('¥12.50')
    expect(formatCents(5)).toBe('¥0.05')
    expect(formatCents(100_000_000, '$')).toBe('$1,000,000.00')
    expect(formatCents(0)).toBe('¥0.00')
  })

  test('负数带负号', () => {
    expect(formatCents(-1250)).toBe('-¥12.50')
  })

  test('格式化与解析互逆', () => {
    for (const cents of [1, 99, 100, 1234, 999_999_999]) {
      const parsed = parseAmountToCents(centsToPlainString(cents).replace('-', ''))
      expect(parsed).toEqual({ ok: true, cents })
    }
  })
})

describe('金额求和不会出现浮点误差', () => {
  test('0.1 元 + 0.2 元 = 0.30 元（不是 0.30000000000000004）', () => {
    const a = parseAmountToCents('0.1')
    const b = parseAmountToCents('0.2')
    if (!a.ok || !b.ok) throw new Error('解析失败')
    const total = sumCents([a.cents, b.cents])
    expect(total).toBe(30)
    expect(formatCents(total)).toBe('¥0.30')
  })

  test('大量小金额累加仍然精确', () => {
    const list = Array.from({ length: 1000 }, () => ({ amountCents: 1 }))
    expect(sumExpenseCents(list)).toBe(1000)
    expect(formatCents(sumExpenseCents(list))).toBe('¥10.00')
  })
})

describe('元与分互转', () => {
  test('centsFromYuan 四舍五入到整数分', () => {
    expect(centsFromYuan(12.34)).toBe(1234)
    expect(centsFromYuan(0.1 + 0.2)).toBe(30)
    expect(centsFromYuan(1 / 3)).toBe(33)
  })

  test('yuanFromCents 还原成元', () => {
    expect(yuanFromCents(1234)).toBe(12.34)
  })
})