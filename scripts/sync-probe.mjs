/**
 * 同步接口探针：拿真实 GitHub API 跑通「读-写-删」一条完整往返。
 * 用途：验证同步引擎用到的每个请求形状真的成立（不是照记忆写的）。
 *
 * 用法：
 *   GH_TOKEN=$(gh auth token) node scripts/sync-probe.mjs [owner/repo]
 * 默认仓库：qqtang-code/cute-ledger-data
 *
 * 它会往数据仓库写一个 probe.json、再加一个 media/demo.webp，然后删掉 media/demo.webp，
 * 最后把 probe.json 也删掉（仓库回到干净状态，只留一个 state.json 占位）。
 */
const API = 'https://api.github.com'
const TOKEN = process.env.GH_TOKEN
const REPO = process.argv[2] ?? 'qqtang-code/cute-ledger-data'
const BRANCH = 'main'

if (!TOKEN) {
  console.error('缺少 GH_TOKEN。用法：GH_TOKEN=$(gh auth token) node scripts/sync-probe.mjs')
  process.exit(1)
}

let calls = 0
async function api(method, path, body) {
  calls += 1
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 300)}`)
  }
  return text ? JSON.parse(text) : null
}

function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` —— ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

const b64 = (value) => Buffer.from(value).toString('base64')

async function readRef() {
  try {
    return await api('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`)
  } catch {
    return null
  }
}

/**
 * 空仓库不能直接建 blob/tree/commit（会 409 Git Repository is empty），
 * 首次必须用 Contents API 建立首个提交，分支才会出现。
 */
async function ensureBranch(initialState) {
  const ref = await readRef()
  if (ref) return ref
  await api('PUT', `/repos/${REPO}/contents/state.json`, {
    message: '初始化同步数据',
    content: b64(initialState),
    branch: BRANCH,
  })
  const created = await readRef()
  if (!created) throw new Error('Contents API 建完首个提交后仍然读不到分支')
  return created
}

async function commitFiles(files, message, deletes = []) {
  const ref = await readRef()
  const parentSha = ref?.object?.sha ?? null

  let baseTree = null
  if (parentSha) {
    const parent = await api('GET', `/repos/${REPO}/git/commits/${parentSha}`)
    baseTree = parent.tree.sha
  }

  const tree = []
  for (const [path, content] of Object.entries(files)) {
    const kind = content instanceof Uint8Array ? 'binary' : 'text'
    const blob = await api('POST', `/repos/${REPO}/git/blobs`, {
      content: kind === 'binary' ? Buffer.from(content).toString('base64') : b64(content),
      encoding: 'base64',
    })
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  // sha 为 null 就是删除（官方文档原文：If the value is null then the file will be deleted）
  for (const path of deletes) {
    tree.push({ path, mode: '100644', type: 'blob', sha: null })
  }

  const treeBody = baseTree ? { base_tree: baseTree, tree } : { tree }
  const newTree = await api('POST', `/repos/${REPO}/git/trees`, treeBody)

  const commitBody = { message, tree: newTree.sha, parents: parentSha ? [parentSha] : [] }
  const commit = await api('POST', `/repos/${REPO}/git/commits`, commitBody)

  if (parentSha) {
    await api('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false })
  } else {
    await api('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha })
  }
  return commit.sha
}

try {
  console.log(`探针目标：${REPO}（分支 ${BRANCH}）\n`)

  const repo = await api('GET', `/repos/${REPO}`)
  check('仓库可读且是私有的', repo.private === true, `${repo.full_name} private=${repo.private}`)

  // 第一次提交：空仓库要先靠 Contents API 建立分支
  await ensureBranch(JSON.stringify({ probe: '初始化', at: new Date().toISOString() }))
  const firstSha = (await readRef()).object.sha
  check('空仓库用 Contents API 建立首个提交与分支', typeof firstSha === 'string' && firstSha.length === 40, firstSha.slice(0, 7))

  // 第二次提交：带二进制附件 + 走 base_tree + PATCH ref
  const fakeImage = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 5, 6, 7, 8])
  const secondSha = await commitFiles(
    {
      'state.json': JSON.stringify({ probe: '第二次提交', at: new Date().toISOString() }),
      'media/demo.webp': fakeImage,
    },
    '探针：加一个附件',
  )
  check('第二次提交（含二进制附件、PATCH ref）', secondSha !== firstSha, secondSha.slice(0, 7))

  const tree = await api('GET', `/repos/${REPO}/git/trees/${BRANCH}?recursive=1`)
  const paths = tree.tree.map((entry) => entry.path)
  check('递归列目录能看到两个文件', paths.includes('state.json') && paths.includes('media/demo.webp'), paths.join(', '))

  const blobSha = tree.tree.find((entry) => entry.path === 'media/demo.webp').sha
  const blob = await api('GET', `/repos/${REPO}/git/blobs/${blobSha}`)
  const back = Buffer.from(blob.content, 'base64')
  check('二进制附件能原样读回来', Buffer.compare(back, Buffer.from(fakeImage)) === 0, `sha=${blobSha.slice(0, 7)} size=${back.length}`)

  // 第三次提交：删附件 + 删 probe 文件
  await commitFiles({ 'state.json': JSON.stringify({ probe: 'clean', at: new Date().toISOString() }) }, '探针：收尾', [
    'media/demo.webp',
  ])
  const after = await api('GET', `/repos/${REPO}/git/trees/${BRANCH}?recursive=1`)
  const afterPaths = after.tree.map((entry) => entry.path)
  check('sha=null 能删除文件', !afterPaths.includes('media/demo.webp'), afterPaths.join(', '))

  console.log(`\n共 ${calls} 次 API 调用，全部成功。同步引擎可以照这套形状写。`)
} catch (error) {
  console.error(`\n✗ 探针失败：${error.message}`)
  process.exitCode = 1
}