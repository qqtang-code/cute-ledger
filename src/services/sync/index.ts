import type { StorageAdapter } from '../../data/ports'
import { DB_VERSION } from '../../data/migrations'
import { GitHubRemoteStore, type RemoteStore } from './github'
import { runSync, type SyncReport } from './engine'

/** token 放 meta 里，不放 settings —— settings 会被导出进备份 zip，token 不该跟着走 */
export const SYNC_TOKEN_META_KEY = 'syncToken'
export const DEFAULT_SYNC_REPO = 'qqtang-code/cute-ledger-data'

export interface SyncConfig {
  repo: string
  branch: string
  enabled: boolean
  token: string
}

export interface SyncService {
  loadConfig(): Promise<SyncConfig>
  saveConfig(patch: Partial<SyncConfig>): Promise<SyncConfig>
  isConfigured(config?: SyncConfig): boolean
  testConnection(config?: SyncConfig): Promise<{ ok: boolean; detail: string }>
  syncNow(config?: SyncConfig): Promise<SyncReport>
}

export function createSyncService(adapter: StorageAdapter, fetchImpl?: typeof fetch): SyncService {
  async function loadConfig(): Promise<SyncConfig> {
    const [settings, token] = await Promise.all([
      adapter.getSettings(),
      adapter.getMeta<string>(SYNC_TOKEN_META_KEY),
    ])
    return {
      repo: settings.syncRepo || DEFAULT_SYNC_REPO,
      branch: settings.syncBranch || 'main',
      enabled: settings.syncEnabled,
      token: token ?? '',
    }
  }

  async function saveConfig(patch: Partial<SyncConfig>): Promise<SyncConfig> {
    const settings = await adapter.getSettings()
    if (patch.repo !== undefined || patch.branch !== undefined || patch.enabled !== undefined) {
      await adapter.saveSettings({
        ...settings,
        syncRepo: patch.repo ?? settings.syncRepo,
        syncBranch: patch.branch ?? settings.syncBranch,
        syncEnabled: patch.enabled ?? settings.syncEnabled,
        updatedAt: new Date().toISOString(),
      })
    }
    if (patch.token !== undefined) {
      if (patch.token === '') await adapter.deleteMeta(SYNC_TOKEN_META_KEY)
      else await adapter.setMeta(SYNC_TOKEN_META_KEY, patch.token)
    }
    return loadConfig()
  }

  function isConfigured(config: SyncConfig): boolean {
    return config.repo.trim() !== '' && config.token.trim() !== '' && config.repo.includes('/')
  }

  function makeRemote(config: SyncConfig): RemoteStore {
    return new GitHubRemoteStore({
      repo: config.repo,
      branch: config.branch,
      token: config.token,
      fetchImpl,
    })
  }

  return {
    loadConfig,
    saveConfig,
    isConfigured,

    async testConnection(config) {
      const current = config ?? (await loadConfig())
      if (current.repo.trim() === '') return { ok: false, detail: '还没填数据仓库' }
      if (current.token.trim() === '') return { ok: false, detail: '还没填 token' }
      return makeRemote(current).testConnection()
    },

    async syncNow(config) {
      const current = config ?? (await loadConfig())
      if (!isConfigured(current)) {
        throw new Error('同步还没配好：要填「owner/repo」和 token')
      }
      return runSync({ adapter, remote: makeRemote(current), schemaVersion: DB_VERSION })
    },
  }
}