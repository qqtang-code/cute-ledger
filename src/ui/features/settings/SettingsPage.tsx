import { useEffect, useRef, useState } from 'react'
import { daysBetween, formatIsoDateTime, toDateString } from '../../../domain/dates'
import { formatBytes } from '../../../domain/media'
import type { ThemeName } from '../../../domain/types'
import { attachmentService, backupService, repository, useLedgerStore } from '../../../store/ledger'
import { useUiStore } from '../../../store/ui'
import type { BackupPreview } from '../../../services/backup'
import { CategoryManager } from '../categories/CategoryManager'
import { SyncPanel } from './SyncPanel'

const THEMES: Array<{ key: ThemeName; label: string; emoji: string }> = [
  { key: 'strawberry', label: '奶油草莓', emoji: '🍓' },
  { key: 'mint', label: '薄荷苏打', emoji: '🌿' },
  { key: 'grape', label: '葡萄汽水', emoji: '🍇' },
]

const CURRENCIES = ['¥', '$', '€', '£', '₩']

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 下载是异步的，稍后再 revoke，否则 Safari 会拿到空文件
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function SettingsPage() {
  const settings = useLedgerStore((s) => s.settings)
  const saveSettings = useLedgerStore((s) => s.saveSettings)
  const reload = useLedgerStore((s) => s.reload)
  const refreshCategories = useLedgerStore((s) => s.refreshCategories)
  const wipeAll = useLedgerStore((s) => s.wipeAll)
  const showToast = useUiStore((s) => s.showToast)

  const [usage, setUsage] = useState({ usedBytes: 0, quotaBytes: 0 })
  const [attachmentBytes, setAttachmentBytes] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<BackupPreview | null>(null)
  const [wipeWord, setWipeWord] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [currencyDraft, setCurrencyDraft] = useState(settings.currencySymbol)

  useEffect(() => {
    void attachmentService.usage().then(setUsage)
    void repository.attachmentsBytes().then(setAttachmentBytes)
  }, [])

  const today = toDateString(new Date())
  const backupAge = settings.lastBackupAt ? daysBetween(settings.lastBackupAt.slice(0, 10), today) : null
  const staleBackup = backupAge === null || backupAge > 30

  async function handleExportZip() {
    setBusy('export')
    try {
      const blob = await backupService.exportZip()
      downloadBlob(blob, `可爱记账本-备份-${today}.zip`)
      await saveSettings({ lastBackupAt: new Date().toISOString() })
      showToast('备份导出好了')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导出失败')
    } finally {
      setBusy(null)
    }
  }

  async function handleExportCsv() {
    setBusy('csv')
    try {
      const blob = await backupService.exportCsv()
      downloadBlob(blob, `可爱记账本-流水-${today}.csv`)
      showToast('CSV 导出好了')
    } finally {
      setBusy(null)
    }
  }

  async function handlePickFile(file: File | undefined) {
    if (!file) return
    setBusy('parse')
    try {
      const preview = await backupService.parseZip(file)
      setPendingImport(preview)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '这个文件读不了')
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleImport(mode: 'merge' | 'replace') {
    if (!pendingImport) return
    setBusy('import')
    try {
      if (mode === 'replace') {
        // 覆盖前先自动导出一份当前数据，防手滑
        const safety = await backupService.exportZip()
        downloadBlob(safety, `覆盖前的自动备份-${today}.zip`)
      }
      const result = await backupService.importPreview(pendingImport, mode)
      await reload()
      await refreshCategories()
      setPendingImport(null)
      showToast(`导入完成：${result.expenses} 笔、${result.attachments} 个附件${result.skipped ? `，跳过 ${result.skipped} 条坏数据` : ''}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入失败')
    } finally {
      setBusy(null)
    }
  }

  async function handleWipe() {
    if (wipeWord !== '删除') {
      showToast('要输入「删除」两个字才能清空')
      return
    }
    await wipeAll()
    setWipeWord('')
    showToast('数据已清空')
  }

  return (
    <section data-testid="page-settings">
      <h1 className="page-title">设置</h1>

      <div className="card">
        <h2 className="card__title">外观</h2>
        <div className="row row--wrap">
          {THEMES.map((theme) => (
            <button
              key={theme.key}
              type="button"
              className={`chip ${settings.theme === theme.key ? 'chip--on' : ''}`}
              onClick={() => void saveSettings({ theme: theme.key })}
              data-testid={`theme-${theme.key}`}
            >
              <span aria-hidden="true">{theme.emoji}</span>
              {theme.label}
            </button>
          ))}
        </div>
        <div className="row row--wrap" style={{ marginTop: 8 }}>
          {(['system', 'light', 'dark'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`chip ${settings.mode === mode ? 'chip--on' : ''}`}
              onClick={() => void saveSettings({ mode })}
              data-testid={`mode-${mode}`}
            >
              {mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">记账偏好</h2>
        <div className="field">
          <span className="field__label">货币符号</span>
          <div className="row">
            {CURRENCIES.map((symbol) => (
              <button
                key={symbol}
                type="button"
                className={`chip ${settings.currencySymbol === symbol ? 'chip--on' : ''}`}
                onClick={() => void saveSettings({ currencySymbol: symbol })}
                data-testid={`currency-${symbol}`}
              >
                {symbol}
              </button>
            ))}
            <input
              type="text"
              value={currencyDraft}
              aria-label="自定义货币符号"
              maxLength={3}
              onChange={(event) => setCurrencyDraft(event.target.value)}
              data-testid="currency-input"
            />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void saveSettings({ currencySymbol: currencyDraft || '¥' })}
              data-testid="currency-save"
            >
              用这个
            </button>
          </div>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <span className="field__label">每周从哪天开始</span>
          <div className="row">
            {([1, 0] as const).map((day) => (
              <button
                key={day}
                type="button"
                className={`chip ${settings.weekStart === day ? 'chip--on' : ''}`}
                onClick={() => void saveSettings({ weekStart: day })}
              >
                {day === 1 ? '周一' : '周日'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <SyncPanel />

      <CategoryManager />

      <div className="card" data-testid="backup-panel">
        <h2 className="card__title">备份与恢复</h2>
        <p className={`backup-hint ${staleBackup ? 'backup-hint--warn' : 'dim'}`} data-testid="backup-hint">
          {settings.lastBackupAt
            ? `上次备份：${formatIsoDateTime(settings.lastBackupAt)}${staleBackup ? '（超过 30 天没备份了，建议再导一次）' : ''}`
            : '还没备份过。数据只存在这台设备上，建议导出一次存好。'}
        </p>
        <div className="row row--wrap">
          <button type="button" className="btn" onClick={() => void handleExportZip()} disabled={busy !== null} data-testid="export-zip">
            {busy === 'export' ? '导出中…' : '导出备份 zip'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void handleExportCsv()} disabled={busy !== null} data-testid="export-csv">
            {busy === 'csv' ? '导出中…' : '导出 CSV'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            data-testid="pick-backup"
          >
            {busy === 'parse' ? '读取中…' : '导入备份'}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/zip,.zip"
          className="sr-only"
          aria-label="选择备份文件"
          data-testid="backup-file-input"
          onChange={(event) => void handlePickFile(event.target.files?.[0])}
        />

        {pendingImport ? (
          <div className="import-preview" data-testid="import-preview">
            <p>
              这个备份里有 <strong>{pendingImport.manifest.counts.expenses}</strong> 笔流水、
              <strong>{pendingImport.manifest.counts.attachments}</strong> 个附件，导出于{' '}
              {formatIsoDateTime(pendingImport.manifest.exportedAt)}
            </p>
            <div className="row row--wrap">
              <button type="button" className="btn" onClick={() => void handleImport('merge')} data-testid="import-merge">
                合并导入
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleImport('replace')}
                data-testid="import-replace"
              >
                覆盖导入
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setPendingImport(null)}>
                算了
              </button>
            </div>
            <p className="dim">覆盖导入会先自动导出一份当前数据。</p>
          </div>
        ) : null}
      </div>

      <div className="card" data-testid="storage-panel">
        <h2 className="card__title">存储</h2>
        <p className="dim">
          附件占用 {formatBytes(attachmentBytes)}
          {usage.quotaBytes > 0 ? ` · 浏览器已用 ${formatBytes(usage.usedBytes)} / ${formatBytes(usage.quotaBytes)}` : ''}
        </p>
        <div className="row row--wrap" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="request-persist"
            onClick={() => {
              void attachmentService.requestPersistence().then(async (granted) => {
                await saveSettings({ persisted: granted })
                showToast(granted ? '已申请长期保存，浏览器不会自动清理' : '这个浏览器不支持长期保存，请定期导出备份')
              })
            }}
          >
            申请长期保存
          </button>
          {settings.persisted ? <span className="tag">已开启</span> : null}
        </div>
        <p className="dim">iOS 可能清理长期不用的网站数据，定期导出备份最稳。</p>
      </div>

      <div className="card">
        <h2 className="card__title">清空数据</h2>
        <p className="dim">会删掉所有流水和附件（分类会重置成内置的 12 个）。删之前先导一份备份。</p>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            type="text"
            placeholder="输入「删除」两个字"
            aria-label="确认清空"
            value={wipeWord}
            onChange={(event) => setWipeWord(event.target.value)}
            data-testid="wipe-input"
          />
          <button type="button" className="btn btn--danger" onClick={() => void handleWipe()} data-testid="wipe-data">
            清空
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">关于</h2>
        <p className="dim">可爱记账本 v0.1.0 · 构建于 {__BUILD_TIME__}</p>
        <p className="dim">
          线上地址：
          <a href="https://qqtang-code.github.io/cute-ledger/">qqtang-code.github.io/cute-ledger</a>
        </p>
        <p className="dim">数据存在这台设备的浏览器里，不上传任何服务器。</p>
      </div>
    </section>
  )
}

declare const __BUILD_TIME__: string

