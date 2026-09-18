import { createIndexedDbAdapter, type IndexedDbAdapter } from '../data/adapters/indexeddb'
import { DB_NAME } from '../data/migrations'

/**
 * 测试用的「设备」辅助。
 *
 * 关键：一台设备 = 一个独立的 IndexedDB 库（库名不同）。
 * 同一个库名的两个适配器实例其实是「同一台设备」——拿它测跨设备同步会得到假绿灯，
 * 因为「另一台」本来就读得到数据，压根没走同步。这是踩过的坑，别再退回去。
 */
const open = new Map<string, IndexedDbAdapter>()
const known = new Set<string>(['main'])

function dbNameOf(name: string): string {
  return name === 'main' ? DB_NAME : `${DB_NAME}-${name}`
}

/** 开一台设备（同一个名字重复调用返回同一个实例） */
export function createDevice(name = 'main'): IndexedDbAdapter {
  known.add(name)
  const existing = open.get(name)
  if (existing) return existing
  const adapter = createIndexedDbAdapter({ dbName: dbNameOf(name) })
  open.set(name, adapter)
  return adapter
}

export async function openDevice(name = 'main'): Promise<IndexedDbAdapter> {
  const adapter = createDevice(name)
  await adapter.init()
  return adapter
}

export function closeAllDevices(): void {
  for (const adapter of open.values()) adapter.close()
  open.clear()
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** 把所有用过的设备库都删掉（连之前测试用过的名字也删，避免串数据） */
export async function resetAllDevices(): Promise<void> {
  closeAllDevices()
  for (const name of known) await deleteDatabase(dbNameOf(name))
}

/** 单设备场景：清空 + 开一台已初始化的设备 */
export async function freshDevice(name = 'main'): Promise<IndexedDbAdapter> {
  await resetAllDevices()
  return openDevice(name)
}

export const resetDatabase = resetAllDevices

// 旧名字（既有测试还在用）
export const closeAllAdapters = closeAllDevices
export const freshAdapter = freshDevice
export const newAdapter = createDevice