import type { RemoteReadResult, RemoteStore, RemoteWriteInput } from '../services/sync/github'
import type { SyncSnapshot } from '../domain/sync'
import type { Id } from '../domain/types'

/**
 * 内存版远端：单测里当「云端仓库」用。
 * 行为对齐真实 GitHub：空仓库没有分支、write 之后 snapshot 和文件都在。
 */
export interface MemoryRemote extends RemoteStore {
  snapshot: SyncSnapshot | null
  files: Map<string, Uint8Array>
  writeCount: number
  lastMessage: string
}

export function createMemoryRemote(initial: SyncSnapshot | null = null): MemoryRemote {
  const state: MemoryRemote = {
    label: 'memory',
    snapshot: initial ? structuredClone(initial) : null,
    files: new Map(),
    writeCount: 0,
    lastMessage: '',

    async read(): Promise<RemoteReadResult> {
      return {
        snapshot: state.snapshot ? structuredClone(state.snapshot) : null,
        files: new Map([...state.files.keys()].map((path) => [idFromPath(path), path] as [Id, string])),
      }
    },

    async readFile(path: string) {
      const data = state.files.get(path)
      if (!data) throw new Error(`内存远端没有这个文件：${path}`)
      return new Uint8Array(data)
    },

    async write({ snapshot, uploads, deletes, message }: RemoteWriteInput) {
      state.snapshot = structuredClone(snapshot)
      for (const upload of uploads) state.files.set(upload.path, new Uint8Array(upload.data))
      for (const path of deletes) state.files.delete(path)
      state.writeCount += 1
      state.lastMessage = message
    },

    async testConnection() {
      return { ok: true, detail: '内存远端' }
    },
  }
  return state

  function idFromPath(path: string): Id {
    return /^media\/([^/]+)\.[a-z0-9]+$/i.exec(path)?.[1] ?? path
  }
}