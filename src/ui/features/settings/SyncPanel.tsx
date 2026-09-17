import { useEffect, useState } from 'react'
import { formatIsoDateTime } from '../../../domain/dates'
import { useLedgerStore } from '../../../store/ledger'
import { useUiStore } from '../../../store/ui'
import { DEFAULT_SYNC_REPO } from '../../../services/sync'

/**
 * 跨设备同步面板。
 * 数据存在本机，另外往一个**私有**数据仓库推一份，手机/电脑各连同一个仓库就互通了。
 * token 只存在这台设备上，不进备份 zip、也不会被同步走。
 */
export function SyncPanel() {
  const sync = useLedgerStore((s) => s.sync)
  const saveSyncConfig = useLedgerStore((s) => s.saveSyncConfig)
  const testSyncConnection = useLedgerStore((s) => s.testSyncConnection)
  const syncNow = useLedgerStore((s) => s.syncNow)
  const showToast = useUiStore((s) => s.showToast)

  const [repo, setRepo] = useState(sync.config.repo || DEFAULT_SYNC_REPO)
  const [branch, setBranch] = useState(sync.config.branch || 'main')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<'test' | 'sync' | null>(null)

  useEffect(() => {
    setRepo(sync.config.repo || DEFAULT_SYNC_REPO)
    setBranch(sync.config.branch || 'main')
  }, [sync.config.repo, sync.config.branch])

  const configured = sync.config.repo !== '' && sync.config.token !== ''

  async function handleSave() {
    await saveSyncConfig({ repo: repo.trim(), branch: branch.trim() || 'main', ...(token.trim() ? { token: token.trim() } : {}) })
    setToken('')
    showToast('同步设置存好了')
  }

  async function handleTest() {
    setBusy('test')
    await saveSyncConfig({ repo: repo.trim(), branch: branch.trim() || 'main', ...(token.trim() ? { token: token.trim() } : {}) })
    setToken('')
    const result = await testSyncConnection()
    setBusy(null)
    showToast(result.detail)
  }

  async function handleSync() {
    setBusy('sync')
    const report = await syncNow()
    setBusy(null)
    if (report) showToast(`同步完成：${report.message}`)
  }

  return (
    <div className="card" data-testid="sync-panel">
      <h2 className="card__title">跨设备同步</h2>
      <p className="dim">
        数据平时存在这台设备上（断网也能记）。配好之后会往一个<strong>私有</strong>数据仓库推一份，
        手机、电脑都连同一个仓库就能互相看到。没配也不影响本地使用。
      </p>

      <div className="field" style={{ marginTop: 12 }}>
        <span className="field__label">数据仓库（owner/repo）</span>
        <input
          type="text"
          value={repo}
          placeholder={DEFAULT_SYNC_REPO}
          aria-label="数据仓库"
          data-testid="sync-repo"
          onChange={(event) => setRepo(event.target.value)}
        />
      </div>

      <div className="field">
        <span className="field__label">分支</span>
        <input
          type="text"
          value={branch}
          aria-label="分支"
          data-testid="sync-branch"
          onChange={(event) => setBranch(event.target.value)}
        />
      </div>

      <div className="field">
        <span className="field__label">访问 token（只存这台设备，不会被同步或导出）</span>
        <input
          type="password"
          value={token}
          placeholder={configured ? '已经配过了，留空表示不改' : '粘一次就行'}
          aria-label="访问 token"
          data-testid="sync-token"
          autoComplete="off"
          onChange={(event) => setToken(event.target.value)}
        />
      </div>

      <div className="row row--wrap" style={{ marginTop: 8 }}>
        <button type="button" className="btn" onClick={() => void handleSave()} data-testid="sync-save">
          保存
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void handleTest()}
          disabled={busy !== null}
          data-testid="sync-test"
        >
          {busy === 'test' ? '测试中…' : '测试连接'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void handleSync()}
          disabled={busy !== null}
          data-testid="sync-now"
        >
          {busy === 'sync' ? '同步中…' : '立即同步'}
        </button>
      </div>

      <label className="field field--inline" style={{ marginTop: 12 }}>
        <input
          type="checkbox"
          checked={sync.config.enabled}
          data-testid="sync-enabled"
          onChange={(event) => void saveSyncConfig({ enabled: event.target.checked })}
        />
        <span>
          打开时自动同步、记完一笔自动上传
          <span className="dim">（关掉就只能手动点「立即同步」）</span>
        </span>
      </label>

      <p className="dim" data-testid="sync-status">
        {sync.status === 'syncing'
          ? '正在同步…'
          : sync.status === 'error'
            ? `上次同步失败：${sync.lastError}`
            : sync.lastSyncAt
              ? `上次同步：${formatIsoDateTime(sync.lastSyncAt)}${sync.lastMessage ? `（${sync.lastMessage}）` : ''}`
              : configured
                ? '还没同步过，点「立即同步」试试'
                : '还没配好'}
      </p>

      <details className="sync-help">
        <summary>怎么弄这个 token？</summary>
        <ol className="sync-help__steps">
          <li>
            打开 GitHub 的 <strong>Settings → Developer settings → Personal access tokens → Fine-grained tokens</strong>
            ，点 Generate new token。
          </li>
          <li>
            <strong>Repository access</strong> 选 Only select repositories，只勾你的数据仓库（
            <code>{repo || DEFAULT_SYNC_REPO}</code>）。
          </li>
          <li>
            <strong>Permissions → Repository permissions → Contents</strong> 设成 <strong>Read and write</strong>
            ，其余不用给。
          </li>
          <li>生成后复制（<code>github_pat_</code> 开头），粘到上面的框里，点「测试连接」。</li>
          <li>每台设备各粘一次。换设备或撤销授权后，旧的 token 作废重生成即可。</li>
        </ol>
        <p className="dim">
          token 等于这把仓库的钥匙，别贴给别人、别贴进聊天记录。建议给它的有效期短一点（比如 90 天），到期重新生成。
        </p>
      </details>
    </div>
  )
}