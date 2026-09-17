import type { Cents } from './types'

/** 9,999,999.99 元 —— SPEC R1 的上限 */
export const MAX_AMOUNT_CENTS = 999_999_999

export type ParseAmountResult = { ok: true; cents: Cents } | { ok: false; reason: string }

/** 全角数字/句点转半角（中文输入法下很常见） */
function normalizeDigits(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[，,]/g, ',')
}

/**
 * 把用户输入的金额字符串解析成整数「分」。
 * 只做结构校验（能不能变成钱），不判断业务规则（>0、上限）——那是 validateAmountCents 的事。
 */
export function parseAmountToCents(input: string): ParseAmountResult {
  const raw = normalizeDigits(input).trim().replace(/\s/g, '').replace(/[¥$€]/g, '').replace(/,/g, '')

  if (raw === '') return { ok: false, reason: '请输入金额' }
  if (!/^\d*\.?\d*$/.test(raw) || raw === '.') return { ok: false, reason: '金额只能是数字' }

  const dot = raw.indexOf('.')
  if (dot >= 0 && raw.length - dot - 1 > 2) return { ok: false, reason: '最多两位小数' }

  const [intPart = '', decPart = ''] = raw.split('.')
  const yuan = Number(intPart === '' ? '0' : intPart)
  const frac = Number((decPart + '00').slice(0, 2))

  // 整数运算，不出现浮点：yuan 是整数，frac 是 0..99 的整数
  const cents = yuan * 100 + frac
  if (!Number.isSafeInteger(cents)) return { ok: false, reason: '金额太大了' }

  return { ok: true, cents }
}

/** 业务规则校验：>0 且不超上限。通过返回 null，否则返回给用户看的中文原因。 */
export function validateAmountCents(cents: Cents): string | null {
  if (!Number.isInteger(cents)) return '金额不合法'
  if (cents <= 0) return '金额要大于 0'
  if (cents > MAX_AMOUNT_CENTS) return '金额超过上限（9,999,999.99）'
  return null
}

/** 千分位分组，不依赖 Intl（保证任何环境结果一致） */
function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 1250 + '¥' → '¥12.50'；永远是两位小数 */
export function formatCents(cents: Cents, symbol = '¥'): string {
  const rounded = Math.round(cents)
  const negative = rounded < 0
  const abs = Math.abs(rounded)
  const yuan = Math.floor(abs / 100)
  const frac = abs % 100
  return `${negative ? '-' : ''}${symbol}${groupThousands(yuan)}.${String(frac).padStart(2, '0')}`
}

/** 不带符号的纯数字串，给 CSV / 输入框回填用 */
export function centsToPlainString(cents: Cents): string {
  const rounded = Math.round(cents)
  const abs = Math.abs(rounded)
  return `${rounded < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** 整数相加，永不引入浮点误差 */
export function sumCents(values: Cents[]): Cents {
  let total = 0
  for (const v of values) total += Math.round(v)
  return total
}

export function sumExpenseCents(list: Array<{ amountCents: Cents }>): Cents {
  let total = 0
  for (const item of list) total += Math.round(item.amountCents)
  return total
}

/** 从元（浮点）安全转成分，用于图表缩放之类的外部输入 */
export function centsFromYuan(yuan: number): Cents {
  return Math.round(yuan * 100)
}

export function yuanFromCents(cents: Cents): number {
  return Math.round(cents) / 100
}