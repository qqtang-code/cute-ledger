import { describe, expect, test } from 'vitest'
import { GitHubRemoteStore, base64ToBytes, bytesToBase64 } from './github'
import { makeCategory, makeExpense, makeSettings } from '../../test/factories'
import type { SyncSnapshot } from '../../domain/sync'

/**
 * 假 GitHub：行为对齐真 API（探针实测过的那几点）：
 * - 空仓库没有分支，ref 返回 404
 * - 空仓库调 Git Data API 的 blob/tree/commit 一律 409 Git Repository is empty
 * - Contents API 的 PUT 能在空仓库里建出第一个提交
 * 每个请求都记下来，用例断言「发出去的请求长什么样」。
 */
function createFakeGitHub(options: { canPush?: boolean } = {}) {
  const blobs = new Map<string, Uint8Array>()
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>()
  const trees = new Map<string, Array<{ path: string; sha: string | null }>>()
  let files = new Map<string, string>()
  let head: string | null = null
  let counter = 0
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = []

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  const fail = (status: number, message: string) => json({ message }, status)

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const path = url.pathname
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    requests.push({ method, path, body })

    if (method === 'GET' && /^\/repos\/[^/]+\/[^/]+$/.test(path)) {
      return json({ full_name: 'me/data', private: true, permissions: { push: options.canPush ?? true } })
    }
    if (method === 'GET' && path.endsWith('/git/ref/heads/main')) {
      return head ? json({ object: { sha: head } }) : fail(404, 'Not Found')
    }
    if (method === 'GET' && path.includes('/git/commits/')) {
      const sha = path.split('/').pop()!
      const commit = commits.get(sha)
      return commit ? json({ tree: { sha: commit.tree } }) : fail(404, 'Not Found')
    }
    if (method === 'GET' && path.includes('/git/trees/')) {
      const ref = decodeURIComponent(path.split('/git/trees/')[1].split('?')[0])
      const entries = ref === 'main' ? files : trees.get(ref) ?? new Map()
      const tree =
        entries instanceof Map
          ? [...entries.entries()].map(([p, sha]) => ({ path: p, sha, type: 'blob', mode: '100644' }))
          : (entries as Array<{ path: string; sha: string | null }>)
              .filter((entry) => entry.sha !== null)
              .map((entry) => ({ path: entry.path, sha: entry.sha, type: 'blob', mode: '100644' }))
      return json({ tree })
    }
    if (method === 'GET' && path.includes('/git/blobs/')) {
      const sha = path.split('/').pop()!
      const data = blobs.get(sha)
      if (!data) return fail(404, 'Not Found')
      return json({ content: bytesToBase64(data), encoding: 'base64' })
    }
    if (method === 'PUT' && path.includes('/contents/')) {
      // Contents API：空仓库也能建出第一个提交
      const file = decodeURIComponent(path.split('/contents/')[1])
      const sha = `blob-${++counter}`
      blobs.set(sha, base64ToBytes(String(body?.content ?? '')))
      const next = new Map(files)
      next.set(file, sha)
      const treeSha = `tree-${++counter}`
      trees.set(treeSha, [...next.entries()].map(([p, s]) => ({ path: p, sha: s })))
      const commitSha = `commit-${++counter}`
      commits.set(commitSha, { tree: treeSha, parents: [], message: String(body?.message ?? '') })
      files = next
      head = commitSha
      return json({ content: { sha } }, 201)
    }
    if (method === 'POST' && path.endsWith('/git/blobs')) {
      if (!head) return fail(409, 'Git Repository is empty.')
      const sha = `blob-${++counter}`
      blobs.set(sha, base64ToBytes(String(body?.content ?? '')))
      return json({ sha }, 201)
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      if (!head) return fail(409, 'Git Repository is empty.')
      const entries = (body?.tree ?? []) as Array<{ path: string; sha: string | null }>
      const base = new Map(files)
      for (const entry of entries) {
        if (entry.sha === null) base.delete(entry.path)
        else base.set(entry.path, entry.sha)
      }
      const treeSha = `tree-${++counter}`
      trees.set(treeSha, [...base.entries()].map(([p, s]) => ({ path: p, sha: s })))
      files = base
      return json({ sha: treeSha }, 201)
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      if (!head) return fail(409, 'Git Repository is empty.')
      const sha = `commit-${++counter}`
      commits.set(sha, {
        tree: String(body?.tree ?? ''),
        parents: (body?.parents ?? []) as string[],
        message: String(body?.message ?? ''),
      })
      head = sha
      return json({ sha }, 201)
    }
    if (method === 'PATCH' && path.includes('/git/refs/')) {
      if (!head) return fail(409, 'Git Repository is empty.')
      head = String(body?.sha ?? head)
      return json({ object: { sha: head } })
    }
    if (method === 'POST' && path.endsWith('/git/refs')) {
      head = String(body?.sha ?? '')
      return json({ ref: 'refs/heads/main' }, 201)
    }
    return fail(404, `未模拟的请求 ${method} ${path}`)
  }) as typeof fetch

  return {
    fetchImpl,
    requests,
    get head() {
      return head
    },
    get files() {
      return files
    },
    readBlob: (sha: string) => blobs.get(sha),
  }
}

function snapshot(over: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    schemaVersion: 2,
    generatedAt: '2026-09-17T12:00:00.000Z',
    expenses: [makeExpense({ id: 'e1', amountCents: 500 })],
    categories: [makeCategory({ id: 'c1' })],
    attachments: [],
    settings: (() => {
      const { currencySymbol, theme, mode, weekStart, monthlyBudgetCents, updatedAt } = makeSettings()
      return { currencySymbol, theme, mode, weekStart, monthlyBudgetCents, updatedAt }
    })(),
    tombstones: {},
    ...over,
  }
}

describe('空仓库的坑', () => {
  test('首次写入走 Contents API（Git Data API 在空仓库会 409）', async () => {
    const fake = createFakeGitHub()
    const remote = new GitHubRemoteStore({ repo: 'me/data', branch: 'main', token: 't', fetchImpl: fake.fetchImpl })

    await remote.write({ snapshot: snapshot(), uploads: [], deletes: [], message: '初始化' })

    expect(fake.requests.some((r) => r.method === 'PUT' && r.path.includes('/contents/state.json'))).toBe(true)
    // 关键：不能是「先傻乎乎地 POST blob 再失败」——blob 请求必须发生在首个提交之后
    const firstBlob = fake.requests.findIndex((r) => r.method === 'POST' && r.path.endsWith('/git/blobs'))
    const putContents = fake.requests.findIndex((r) => r.method === 'PUT' && r.path.includes('/contents/'))
    expect(putContents).toBeLessThan(firstBlob === -1 ? Infinity : firstBlob)
    expect(fake.head).toBeTruthy()
  })

  test('第二次写入走 Git Data API：blob → tree(base_tree) → commit(parents) → PATCH ref', async () => {
    const fake = createFakeGitHub()
    const remote = new GitHubRemoteStore({ repo: 'me/data', branch: 'main', token: 't', fetchImpl: fake.fetchImpl })
    await remote.write({ snapshot: snapshot(), uploads: [], deletes: [], message: '第一次' })
    fake.requests.length = 0

    await remote.write({
      snapshot: snapshot({ expenses: [makeExpense({ id: 'e2' })] }),
      uploads: [{ path: 'media/a1.webp', data: new Uint8Array([7, 7, 7]) }],
      deletes: ['media/gone.webp'],
      message: '第二次',
    })

    const treeRequest = fake.requests.find((r) => r.method === 'POST' && r.path.endsWith('/git/trees'))
    expect(treeRequest).toBeTruthy()
    expect(treeRequest!.body?.base_tree).toBeTruthy()
    const tree = treeRequest!.body?.tree as Array<{ path: string; sha: string | null }>
    expect(tree.some((entry) => entry.path === 'media/gone.webp' && entry.sha === null)).toBe(true)
    expect(tree.some((entry) => entry.path === 'media/a1.webp' && typeof entry.sha === 'string')).toBe(true)

    const commitRequest = fake.requests.find((r) => r.method === 'POST' && r.path.endsWith('/git/commits'))
    expect(commitRequest!.body?.parents).toHaveLength(1)

    const patch = fake.requests.find((r) => r.method === 'PATCH' && r.path.includes('/git/refs/heads/main'))
    expect(patch).toBeTruthy()
    expect(patch!.body?.sha).toBeTruthy()
  })
})

describe('读回来', () => {
  test('read() 能拿到快照和已有哪些附件文件', async () => {
    const fake = createFakeGitHub()
    const remote = new GitHubRemoteStore({ repo: 'me/data', branch: 'main', token: 't', fetchImpl: fake.fetchImpl })
    const original = snapshot({ expenses: [makeExpense({ id: 'e1', amountCents: 777 })] })
    await remote.write({
      snapshot: original,
      uploads: [{ path: 'media/a1.webp', data: new Uint8Array([1, 2, 3]) }],
      deletes: [],
      message: '首次',
    })

    const result = await remote.read()
    expect(result.snapshot?.expenses[0].amountCents).toBe(777)
    expect([...result.files.keys()]).toEqual(['a1'])
    expect(await remote.readFile('media/a1.webp')).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('空仓库 read() 返回 null 快照，不报错', async () => {
    const fake = createFakeGitHub()
    const remote = new GitHubRemoteStore({ repo: 'me/data', branch: 'main', token: 't', fetchImpl: fake.fetchImpl })
    const result = await remote.read()
    expect(result.snapshot).toBeNull()
    expect(result.files.size).toBe(0)
  })
})

describe('出错与探测', () => {
  test('API 报错时把 GitHub 的原话带出来', async () => {
    const fake = createFakeGitHub()
    const remote = new GitHubRemoteStore({ repo: 'me/nope', branch: 'main', token: 't', fetchImpl: fake.fetchImpl })
    await expect(remote.readFile('media/nothing.webp')).rejects.toThrow(/远端没有这个文件/)
  })

  test('testConnection 能看出 token 没有写权限', async () => {
    const fake = createFakeGitHub({ canPush: false })
    const remote = new GitHubRemoteStore({ repo: 'me/data', branch: 'main', token: 't', fetchImpl: fake.fetchImpl })
    const result = await remote.testConnection()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('没有写权限')
  })

  test('testConnection 报告私有仓库与空仓库状态', async () => {
    const fake = createFakeGitHub()
    const remote = new GitHubRemoteStore({ repo: 'me/data', branch: 'main', token: 't', fetchImpl: fake.fetchImpl })
    const result = await remote.testConnection()
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('私有')
    expect(result.detail).toContain('空仓库')
  })

  test('仓库名允许直接粘 GitHub 网址', async () => {
    const fake = createFakeGitHub()
    const remote = new GitHubRemoteStore({
      repo: 'https://github.com/me/data.git',
      branch: 'main',
      token: 't',
      fetchImpl: fake.fetchImpl,
    })
    await remote.read()
    expect(fake.requests[0].path.startsWith('/repos/me/data')).toBe(true)
  })
})

describe('base64 编解码', () => {
  test('二进制往返一致（含 0 和 255）', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255, 0, 42])
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes))
  })

  test('大数组不会爆栈（视频有好几 MB）', () => {
    const big = new Uint8Array(300_000).fill(7)
    expect(base64ToBytes(bytesToBase64(big)).length).toBe(big.length)
  })
})