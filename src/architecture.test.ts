import { describe, expect, test } from 'vitest'

/**
 * 架构测试：把 ARCHITECTURE.md 里的分层约束变成机器可判的断言。
 * 这些约束挂了 = 分层被绕过去了，半年后再加功能就会到处改。
 * 用 Vite 的 import.meta.glob 读源码，避免给项目引入 Node 类型依赖。
 */
const sources = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const entries = Object.entries(sources).filter(([path]) => !path.includes('.test.'))

function filesUnder(prefix: string): Array<[string, string]> {
  return entries.filter(([path]) => path.startsWith(prefix))
}

function importsOf(code: string): string[] {
  const out: string[] = []
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) out.push(m[1])
  return out
}

describe('分层约束', () => {
  test('只有 data/adapters/indexeddb.ts 允许 import idb', () => {
    const offenders = entries
      .filter(([, code]) => importsOf(code).includes('idb'))
      .map(([path]) => path)
    expect(offenders).toEqual(['./data/adapters/indexeddb.ts'])
  })

  test('ui/ 和 app/ 不许直接碰数据库', () => {
    const offenders = filesUnder('./ui/')
      .concat(filesUnder('./app/'))
      .filter(([, code]) => /['"]idb['"]|indexedDB|from\s+['"].*data\/adapters/.test(code))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  test('domain/ 是纯逻辑：只许相对 import，不许外部包', () => {
    const offenders: string[] = []
    for (const [path, code] of filesUnder('./domain/')) {
      for (const spec of importsOf(code)) {
        if (!spec.startsWith('.')) offenders.push(`${path} → ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test('domain/ 不许读时钟、不许碰浏览器 API（否则单测没法稳定复现）', () => {
    const offenders: string[] = []
    for (const [path, code] of filesUnder('./domain/')) {
      if (/Date\.now\(/.test(code)) offenders.push(`${path} 用了 Date.now`)
      if (/\bwindow\.|\bdocument\.|\blocalStorage\b|\bnavigator\./.test(code)) offenders.push(`${path} 碰了浏览器 API`)
    }
    expect(offenders).toEqual([])
  })

  test('domain/ 不许出现浮点金额运算的写法（金额一律整数分）', () => {
    const offenders: string[] = []
    for (const [path, code] of filesUnder('./domain/')) {
      if (/\bamountCents\s*[*\/]/.test(code) || /\*=\s*100\b/.test(code)) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })

  test('services/ 不碰 UI，ui/ 不碰存储实现', () => {
    const servicesImportUi = filesUnder('./services/')
      .filter(([, code]) => importsOf(code).some((s) => s.includes('/ui/') || s.includes('react')))
      .map(([path]) => path)
    expect(servicesImportUi).toEqual([])
  })

  test('源码里真的有这些分层目录（目录被搬走会挂）', () => {
    for (const dir of ['./domain/', './data/', './store/', './ui/', './app/']) {
      expect(filesUnder(dir).length, `${dir} 下没有源文件`).toBeGreaterThan(0)
    }
  })
})