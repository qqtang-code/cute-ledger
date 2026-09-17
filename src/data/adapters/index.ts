import type { StorageAdapter } from '../ports'
import { createIndexedDbAdapter } from './indexeddb'

/**
 * 适配器注册表（ARCHITECTURE.md 扩展点 3）。
 * 以后要接云同步 / 把附件写回 GitHub 仓库，就在这里注册一个新适配器，
 * 界面和 services 都不用改——它们只认 ports.StorageAdapter 这个接口。
 */
export type AdapterName = 'indexeddb'

export function createAdapter(_name: AdapterName = 'indexeddb'): StorageAdapter {
  return createIndexedDbAdapter()
}

export const storage: StorageAdapter = createAdapter('indexeddb')