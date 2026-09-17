import type { Route } from '@playwright/test'

/**
 * 假的 api.github.com：行为对齐真 API（探针实测过的那几点）。
 * 两个浏览器上下文共用同一份 state，就相当于两台设备连同一个仓库。
 */
export interface FakeGitHubState {
  blobs: Map<string, string>
  trees: Map<string, Array<{ path: string; sha: string | null }>>
  commits: Map<string, { tree: string; parents: string[] }>
  files: Map<string, string>
  head: string | null
  counter: number
  writeCount: number
  requests: string[]
}

export function createFakeGitHubState(): FakeGitHubState {
  return {
    blobs: new Map(),
    trees: new Map(),
    commits: new Map(),
    files: new Map(),
    head: null,
    counter: 0,
    writeCount: 0,
    requests: [],
  }
}

// 用 btoa/atob 而不是 Buffer：这个文件同时被 Playwright(Node) 读，
// 类型层没有 @types/node，而 btoa/atob 在 Node 和浏览器里都是全局的
const b64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const unb64 = (value: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)))

export async function handleGitHubRoute(state: FakeGitHubState, route: Route): Promise<void> {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname
  const method = request.method()
  let body: Record<string, unknown> | null = null
  try {
    body = request.postDataJSON() as Record<string, unknown>
  } catch {
    body = null
  }
  state.requests.push(`${method} ${path}`)

  const json = (payload: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })

  if (method === 'GET' && /^\/repos\/[^/]+\/[^/]+$/.test(path)) {
    return json({ full_name: 'test/data', private: true, permissions: { push: true } })
  }

  if (method === 'GET' && path.endsWith('/git/ref/heads/main')) {
    return state.head ? json({ object: { sha: state.head } }) : json({ message: 'Not Found' }, 404)
  }

  if (method === 'GET' && path.includes('/git/commits/')) {
    const sha = path.split('/').pop() ?? ''
    const commit = state.commits.get(sha)
    return commit ? json({ tree: { sha: commit.tree } }) : json({ message: 'Not Found' }, 404)
  }

  if (method === 'GET' && path.includes('/git/trees/')) {
    const entries = [...state.files.entries()].map(([p, sha]) => ({ path: p, sha, type: 'blob', mode: '100644' }))
    return json({ tree: entries })
  }

  if (method === 'GET' && path.includes('/git/blobs/')) {
    const sha = path.split('/').pop() ?? ''
    const data = state.blobs.get(sha)
    return data === undefined ? json({ message: 'Not Found' }, 404) : json({ content: data, encoding: 'base64' })
  }

  // Contents API：空仓库也能建出第一个提交（真 API 就是这样）
  if (method === 'PUT' && path.includes('/contents/')) {
    const file = decodeURIComponent(path.split('/contents/')[1] ?? 'state.json')
    const blobSha = `blob-${++state.counter}`
    state.blobs.set(blobSha, String(body?.content ?? ''))
    state.files.set(file, blobSha)
    const treeSha = `tree-${++state.counter}`
    state.trees.set(treeSha, [...state.files.entries()].map(([p, sha]) => ({ path: p, sha })))
    const commitSha = `commit-${++state.counter}`
    state.commits.set(commitSha, { tree: treeSha, parents: [] })
    state.head = commitSha
    state.writeCount += 1
    return json({ content: { sha: blobSha } }, 201)
  }

  if (method === 'POST' && path.endsWith('/git/blobs')) {
    if (!state.head) return json({ message: 'Git Repository is empty.' }, 409)
    const sha = `blob-${++state.counter}`
    state.blobs.set(sha, String(body?.content ?? ''))
    return json({ sha }, 201)
  }

  if (method === 'POST' && path.endsWith('/git/trees')) {
    if (!state.head) return json({ message: 'Git Repository is empty.' }, 409)
    const entries = (body?.tree ?? []) as Array<{ path: string; sha: string | null }>
    const next = new Map(state.files)
    for (const entry of entries) {
      if (entry.sha === null) next.delete(entry.path)
      else next.set(entry.path, entry.sha)
    }
    state.files = next
    const treeSha = `tree-${++state.counter}`
    state.trees.set(treeSha, [...next.entries()].map(([p, sha]) => ({ path: p, sha })))
    return json({ sha: treeSha }, 201)
  }

  if (method === 'POST' && path.endsWith('/git/commits')) {
    if (!state.head) return json({ message: 'Git Repository is empty.' }, 409)
    const sha = `commit-${++state.counter}`
    state.commits.set(sha, { tree: String(body?.tree ?? ''), parents: (body?.parents ?? []) as string[] })
    state.head = sha
    return json({ sha }, 201)
  }

  if (method === 'PATCH' && path.includes('/git/refs/')) {
    state.head = String(body?.sha ?? state.head)
    return json({ object: { sha: state.head } })
  }

  if (method === 'POST' && path.endsWith('/git/refs')) {
    state.head = String(body?.sha ?? '')
    return json({ ref: 'refs/heads/main' }, 201)
  }

  return json({ message: `未模拟：${method} ${path}` }, 404)
}

/** 从远端 state 里解出最新的 state.json（用于断言云端到底存了什么） */
export function readRemoteState(state: FakeGitHubState): Record<string, unknown> | null {
  const sha = state.files.get('state.json')
  if (!sha) return null
  const content = state.blobs.get(sha)
  return content ? (JSON.parse(unb64(content)) as Record<string, unknown>) : null
}

export { b64 }