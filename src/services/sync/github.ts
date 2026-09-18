import type { Id } from '../../domain/types'
import { isSyncSnapshot, type SyncSnapshot } from '../../domain/sync'

/** 远端读回来的东西 */
export interface RemoteReadResult {
  snapshot: SyncSnapshot | null
  /** 远端 media/ 下已有的附件 id → 文件路径 */
  files: Map<Id, string>
  /** 需要让用户知道的情况，比如「远端文件格式不对，已按空仓库处理」 */
  warning?: string
}

export interface RemoteUpload {
  path: string
  data: Uint8Array
}

export interface RemoteWriteInput {
  snapshot: SyncSnapshot
  uploads: RemoteUpload[]
  /** 远端要删掉的路径 */
  deletes: string[]
  message: string
}

/**
 * 云端仓库的抽象。目前只有 GitHub 一种实现（Git Data API）。
 * 想换成别的后端，实现这个接口就行，同步引擎不用改。
 */
export interface RemoteStore {
  readonly label: string
  read(): Promise<RemoteReadResult>
  write(input: RemoteWriteInput): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  /** 只读探测：仓库在不在、token 有没有写权限 */
  testConnection(): Promise<{ ok: boolean; detail: string }>
}

const API = 'https://api.github.com'
const STATE_PATH = 'state.json'

/** 带状态码的错误，调用方要按码分支，不能靠猜文案 */
export class GitHubHttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GitHubHttpError'
    this.status = status
  }
}

/**
 * 「仓库是空的」有两种说法，都是实测出来的（在零提交的真仓库上量的）：
 *   - 一次都没有提交过：/git/ref/heads/x 和 /git/trees/x 都返回 **409** Git Repository is empty
 *   - 有提交但零文件（git 空树）：/git/trees/x 返回 **404**
 * 两种都不是故障，调用方一律当成「空」——首次同步就靠这个判断走初始化分支。
 */
export function isEmptyRepoError(error: unknown): boolean {
  return error instanceof GitHubHttpError && (error.status === 404 || error.status === 409)
}

/**
 * git 的空树对象 sha：仓库有提交但零文件时，父提交的 tree 就是它。
 * 这个对象在服务端并不存在，拿它当 base_tree 会 404（探针实测），所以遇到时要省略 base_tree。
 */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export function bytesToBase64(bytes: Uint8Array): string {
  // 分块转换：一次性展开大数组会爆栈（视频动辄几 MB）
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ''))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export interface GitHubRemoteOptions {
  repo: string
  branch: string
  token: string
  fetchImpl?: typeof fetch
}

interface TreeEntry {
  path: string
  sha: string
  type: string
}

export class GitHubRemoteStore implements RemoteStore {
  readonly label: string
  private repo: string
  private branch: string
  private token: string
  private request: typeof fetch

  constructor(options: GitHubRemoteOptions) {
    this.repo = options.repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')
    this.branch = options.branch || 'main'
    this.token = options.token.trim()
    this.request = options.fetchImpl ?? fetch.bind(globalThis)
    this.label = `${this.repo}@${this.branch}`
  }

  private async api(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.request(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await response.text()
    if (!response.ok) {
      // 把 GitHub 的原话带出去，方便领导对着排错
      let detail = text.slice(0, 200)
      try {
        detail = (JSON.parse(text) as { message?: string }).message ?? detail
      } catch {
        /* 原样用文本 */
      }
      throw new GitHubHttpError(response.status, `GitHub ${method} ${path} 失败（${response.status}）：${detail}`)
    }
    return text ? JSON.parse(text) : null
  }

  private async readRef(): Promise<string | null> {
    try {
      const ref = (await this.api('GET', `/repos/${this.repo}/git/ref/heads/${this.branch}`)) as {
        object: { sha: string }
      }
      return ref.object.sha
    } catch (error) {
      if (isEmptyRepoError(error)) return null
      throw error
    }
  }

  private async listTree(): Promise<TreeEntry[]> {
    try {
      const tree = (await this.api('GET', `/repos/${this.repo}/git/trees/${this.branch}?recursive=1`)) as {
        tree: TreeEntry[]
      }
      return tree.tree ?? []
    } catch (error) {
      // 409 = 一次都没提交过；404 = 有提交但零文件。两种情况都是「空的」。
      if (isEmptyRepoError(error)) return []
      throw error
    }
  }

  async read(): Promise<RemoteReadResult> {
    const ref = await this.readRef()
    if (!ref) return { snapshot: null, files: new Map() }

    const entries = await this.listTree()
    const files = new Map<Id, string>()
    for (const entry of entries) {
      const match = /^media\/([^/]+)\.[a-z0-9]+$/i.exec(entry.path)
      if (match) files.set(match[1], entry.path)
    }

    const stateEntry = entries.find((entry) => entry.path === STATE_PATH)
    if (!stateEntry) return { snapshot: null, files }

    const blob = (await this.api('GET', `/repos/${this.repo}/git/blobs/${stateEntry.sha}`)) as { content: string }
    const text = new TextDecoder().decode(base64ToBytes(blob.content))

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { snapshot: null, files, warning: '远端 state.json 不是合法 JSON，已按空仓库处理（下次同步会覆盖它）' }
    }
    if (!isSyncSnapshot(parsed)) {
      return { snapshot: null, files, warning: '远端 state.json 不是本账本的快照，已按空仓库处理（下次同步会覆盖它）' }
    }
    return { snapshot: parsed, files }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const entries = await this.listTree()
    const entry = entries.find((item) => item.path === path)
    if (!entry) throw new Error(`远端没有这个文件：${path}`)
    const blob = (await this.api('GET', `/repos/${this.repo}/git/blobs/${entry.sha}`)) as { content: string }
    return base64ToBytes(blob.content)
  }

  /**
   * 空仓库有个坑：没有首个提交之前，Git Data API 一律返回 409 Git Repository is empty。
   * 所以首次必须用 Contents API 建立第一个提交，分支才会存在（这条是探针实测出来的）。
   */
  private async ensureBranch(snapshot: SyncSnapshot): Promise<void> {
    const ref = await this.readRef()
    if (ref) return
    await this.api('PUT', `/repos/${this.repo}/contents/${STATE_PATH}`, {
      message: '初始化同步数据',
      content: bytesToBase64(new TextEncoder().encode(JSON.stringify(snapshot))),
      branch: this.branch,
    })
    const created = await this.readRef()
    if (!created) throw new Error('初始化数据仓库失败：建完首个提交仍然读不到分支')
  }

  async write({ snapshot, uploads, deletes, message }: RemoteWriteInput): Promise<void> {
    await this.ensureBranch(snapshot)

    const parentSha = await this.readRef()
    let baseTree: string | null = null
    if (parentSha) {
      const parent = (await this.api('GET', `/repos/${this.repo}/git/commits/${parentSha}`)) as {
        tree: { sha: string }
      }
      baseTree = parent.tree.sha === EMPTY_TREE_SHA ? null : parent.tree.sha
    }

    const tree: Array<Record<string, unknown>> = []

    const blob = (await this.api('POST', `/repos/${this.repo}/git/blobs`, {
      content: bytesToBase64(new TextEncoder().encode(JSON.stringify(snapshot))),
      encoding: 'base64',
    })) as { sha: string }
    tree.push({ path: STATE_PATH, mode: '100644', type: 'blob', sha: blob.sha })

    for (const upload of uploads) {
      const mediaBlob = (await this.api('POST', `/repos/${this.repo}/git/blobs`, {
        content: bytesToBase64(upload.data),
        encoding: 'base64',
      })) as { sha: string }
      tree.push({ path: upload.path, mode: '100644', type: 'blob', sha: mediaBlob.sha })
    }

    // sha 为 null = 删除这个路径（官方文档原文：If the value is null then the file will be deleted）
    // 没有 base_tree（首个提交 / 空树）时没有东西可删，跳过
    if (baseTree) {
      for (const path of deletes) {
        tree.push({ path, mode: '100644', type: 'blob', sha: null })
      }
    }

    const newTree = (await this.api('POST', `/repos/${this.repo}/git/trees`, baseTree ? { base_tree: baseTree, tree } : { tree })) as {
      sha: string
    }
    const commit = (await this.api('POST', `/repos/${this.repo}/git/commits`, {
      message,
      tree: newTree.sha,
      parents: parentSha ? [parentSha] : [],
    })) as { sha: string }

    if (parentSha) {
      await this.api('PATCH', `/repos/${this.repo}/git/refs/heads/${this.branch}`, { sha: commit.sha, force: false })
    } else {
      await this.api('POST', `/repos/${this.repo}/git/refs`, { ref: `refs/heads/${this.branch}`, sha: commit.sha })
    }
  }

  async testConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      const repo = (await this.api('GET', `/repos/${this.repo}`)) as {
        full_name: string
        private: boolean
        permissions?: { push?: boolean }
      }
      const canPush = repo.permissions?.push
      if (canPush === false) {
        return { ok: false, detail: `${repo.full_name} 能连上，但这个 token 没有写权限` }
      }
      const branch = await this.readRef()
      return {
        ok: true,
        detail: `${repo.full_name}（${repo.private ? '私有' : '公开'}）连接正常，${branch ? '已有同步数据' : '还是空仓库，第一次同步会初始化'}`,
      }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : '连接失败' }
    }
  }
}