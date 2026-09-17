import { createIndexedDbAdapter, type IndexedDbAdapter } from '../data/adapters/indexeddb'
import { DB_NAME } from '../data/migrations'

const opened: IndexedDbAdapter[] = []

/** 建一个适配器并登记，测试结束时统一关闭（IndexedDB 连接没关就删库会卡住） */
export function newAdapter(): IndexedDbAdapter {
  const adapter = createIndexedDbAdapter()
  opened.push(adapter)
  return adapter
}

export function closeAllAdapters(): void {
  for (const adapter of opened) adapter.close()
  opened.length = 0
}

/** 关掉所有连接 → 删库 → 得到一个全新环境 */
export async function resetDatabase(): Promise<void> {
  closeAllAdapters()
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** 常用组合：干净库 + 已初始化的适配器 */
export async function freshAdapter(): Promise<IndexedDbAdapter> {
  await resetDatabase()
  const adapter = newAdapter()
  await adapter.init()
  return adapter
}