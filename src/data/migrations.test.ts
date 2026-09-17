import { describe, expect, test } from 'vitest'
import {
  DB_VERSION,
  DEFAULT_CATEGORIES,
  STORE_ATTACHMENTS,
  STORE_CATEGORIES,
  STORE_EXPENSES,
  STORE_META,
  STORE_SETTINGS,
  migrations,
  runMigrations,
  type MigrationDb,
  type MigrationTx,
} from './migrations'

function makeMock() {
  const calls: string[] = []
  const db: MigrationDb = {
    createObjectStore(name) {
      calls.push(`store:${name}`)
      return {
        createIndex(indexName) {
          calls.push(`index:${name}.${indexName}`)
          return null
        },
      }
    },
  }
  const tx: MigrationTx = {
    objectStore(name) {
      return {
        put() {
          calls.push(`put:${name}`)
          return null
        },
      }
    },
  }
  return { db, tx, calls }
}

describe('迁移函数表', () => {
  test('每个版本都有对应的迁移函数（加版本忘了写迁移会在这里挂掉）', () => {
    for (let v = 1; v <= DB_VERSION; v++) {
      expect(typeof migrations[v], `缺少 v${v} 的迁移函数`).toBe('function')
    }
    expect(migrations[DB_VERSION + 1]).toBeUndefined()
  })

  test('v1 建 5 张表、4 个索引、写入内置分类和版本号', () => {
    const { db, tx, calls } = makeMock()
    runMigrations(db, tx, 0, 1)

    expect(calls.filter((c) => c.startsWith('store:'))).toEqual([
      `store:${STORE_EXPENSES}`,
      `store:${STORE_ATTACHMENTS}`,
      `store:${STORE_CATEGORIES}`,
      `store:${STORE_SETTINGS}`,
      `store:${STORE_META}`,
    ])
    expect(calls.filter((c) => c.startsWith('index:'))).toEqual([
      `index:${STORE_EXPENSES}.spentAt`,
      `index:${STORE_EXPENSES}.categoryId`,
      `index:${STORE_ATTACHMENTS}.expenseId`,
      `index:${STORE_CATEGORIES}.order`,
    ])
    expect(calls.filter((c) => c === `put:${STORE_CATEGORIES}`)).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(calls).toContain(`put:${STORE_META}`)
  })

  test('从 0 升到当前版本：每个版本的迁移按顺序执行且只执行一次', () => {
    const { db, tx, calls } = makeMock()
    runMigrations(db, tx, 0, DB_VERSION)
    expect(calls.filter((c) => c.startsWith('store:'))).toHaveLength(5)
  })

  test('已经是最新版时不重复建表（老数据不会被覆盖）', () => {
    const { db, tx, calls } = makeMock()
    runMigrations(db, tx, DB_VERSION, DB_VERSION)
    expect(calls.filter((c) => c.startsWith('store:'))).toEqual([])
    // 仍然会写一次版本号，这是幂等的
    expect(calls).toEqual([`put:${STORE_META}`])
  })
})

describe('内置分类', () => {
  test('12 个、id 不重复、有 emoji 和顺序', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(12)
    expect(new Set(DEFAULT_CATEGORIES.map((c) => c.id)).size).toBe(12)
    expect(new Set(DEFAULT_CATEGORIES.map((c) => c.order)).size).toBe(12)
    for (const c of DEFAULT_CATEGORIES) {
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.emoji.length).toBeGreaterThan(0)
      expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})