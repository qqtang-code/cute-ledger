import { describe, expect, test } from 'vitest'
import { CSV_BOM, EXPENSE_CSV_HEADER, buildCsv, csvEscape, expensesToCsv } from './csv'
import { makeCategory, makeExpense } from '../test/factories'

describe('CSV 转义', () => {
  test('普通文本原样输出', () => {
    expect(csvEscape('午饭')).toBe('午饭')
    expect(csvEscape('12.34')).toBe('12.34')
  })

  test('含逗号、引号、换行的值加引号并把引号翻倍', () => {
    expect(csvEscape('午饭,加饮料')).toBe('"午饭,加饮料"')
    expect(csvEscape('他说"好吃"')).toBe('"他说""好吃"""')
    expect(csvEscape('第一行\n第二行')).toBe('"第一行\n第二行"')
  })

  test('带 BOM，Excel 打开不乱码', () => {
    expect(buildCsv([['a']]).startsWith(CSV_BOM)).toBe(true)
  })

  test('用 CRLF 换行', () => {
    expect(buildCsv([['a'], ['b']])).toBe(`${CSV_BOM}a\r\nb`)
  })
})

describe('流水导出', () => {
  const categories = [
    makeCategory({ id: 'cat-food', name: '餐饮' }),
    makeCategory({ id: 'cat-old', name: '旧分类', archived: true }),
  ]

  test('表头齐全', () => {
    const csv = expensesToCsv([], categories)
    expect(csv).toBe(`${CSV_BOM}${EXPENSE_CSV_HEADER.join(',')}`)
  })

  test('金额按元输出、分类名带归档标记、标签用空格连、附件数量正确', () => {
    const csv = expensesToCsv(
      [
        makeExpense({
          id: 'e1',
          amountCents: 12_345,
          categoryId: 'cat-food',
          note: '午饭',
          tags: ['工作日', '外卖'],
          spentAt: '2026-09-17',
          attachmentIds: ['a1', 'a2'],
        }),
        makeExpense({ id: 'e2', amountCents: 100, categoryId: 'cat-old', spentAt: '2026-09-16' }),
      ],
      categories,
    )
    const lines = csv.replace(CSV_BOM, '').split('\r\n')
    expect(lines[1]).toBe('2026-09-17,123.45,餐饮,午饭,工作日 外卖,2')
    expect(lines[2]).toBe('2026-09-16,1.00,旧分类(已归档),,,0')
  })

  test('备注里的逗号不会把列挤歪', () => {
    const csv = expensesToCsv(
      [makeExpense({ amountCents: 500, categoryId: 'cat-food', note: '咖啡,蛋糕', spentAt: '2026-09-17' })],
      categories,
    )
    const line = csv.replace(CSV_BOM, '').split('\r\n')[1]
    expect(line).toContain('"咖啡,蛋糕"')
    // 逗号在引号里，所以按「引号外的逗号」切出来仍然是 6 列
    expect(line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).toHaveLength(6)
  })

  test('按日期倒序输出', () => {
    const csv = expensesToCsv(
      [
        makeExpense({ id: 'old', spentAt: '2026-09-01' }),
        makeExpense({ id: 'new', spentAt: '2026-09-20' }),
      ],
      categories,
    )
    const lines = csv.replace(CSV_BOM, '').split('\r\n')
    expect(lines[1]).toContain('2026-09-20')
    expect(lines[2]).toContain('2026-09-01')
  })
})