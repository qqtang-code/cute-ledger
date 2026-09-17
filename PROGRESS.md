# PROGRESS · 可爱记账本

## 开工回执（2026-09-17）

**理解的目标**：一个自用的可爱风记账 PWA，手机浏览器打开就能记一笔、翻历史、看照片附件；数据存本机 IndexedDB，能导出 zip 备份；部署到 https://qqtang-code.github.io/cute-ledger/ ；分层架构，方便领导后续自己加功能。

**实施顺序**
1. 任务 1 骨架：vite+react+ts、分层目录、主题令牌、底部导航、三页互跳（HashRouter）。
2. 任务 2 数据层：domain 纯函数 + 迁移表 + IndexedDB 适配器 + repository，单测 ≥25 条（先做数据层，因为记账/统计/备份全压在它上面，它错了后面全错）。
3. 任务 3 记账主线 R1–R5。
4. 任务 4 统计与周边 R6–R11。
5. 任务 5 上线：deploy.yml、建仓推送、启用 Pages。

**最大风险**
1. 单测环境没有真 IndexedDB，必须用 fake-indexeddb（结构差异会导致「测过了但线上坏」）→ 任务 3 的 E2E 必须用真 Chrome 的真 IndexedDB 再验一遍。
2. 图片压缩（canvas→WebP）在 Node 里测不了，尺寸/长边逻辑要抽成 domain 纯函数测，真实压缩效果靠 E2E 断言落库 Blob 的大小。
3. Service Worker 缓存会让 E2E 假绿/假红 → playwright 配 `serviceWorkers: 'block'`。
4. Pages 首次启用那条 API 我无法预先实测（手上没仓库），失败按 SPEC R14 退 gh-pages 分支路线。

**任务 0 核对结果**（全部一致，可动工）
- node v24.15.0 / npm 11.12.1 / git 2.50.1 / gh 2.97.0（qqtang-code，scope: gist, read:org, repo, workflow）
- Chrome 153.0.8010.47 已装
- ARCHITECTURE.md sha256 = 07c223f3df3f1d3055e7583939c2ffb8f92ef4d13c2f5c6a54b0ff1a757b3a7d ✓
- SPEC.md sha256 = 31b18c0ba56d22498787eafc0a7f5da99de621f7c8b6ffcfc10de56124173df5 ✓
- 目标目录 /Users/qqtang/.zcode/workspace/default/cute-ledger/ 原本不存在，已新建并 git init

## 进度

- [x] 任务 0 环境与规格核对
- [x] 任务 1 骨架 —— 验收：`npx vite build` 退出 0；`npx tsc --noEmit` 退出 0；`npx playwright test` 6 passed（移动 390×844 + 桌面 1280×800 各 3 条）
- [ ] 任务 2 数据层
- [ ] 任务 3 记账主线
- [ ] 任务 4 统计与周边
- [ ] 任务 5 上线

## 偏离规格的地方（都记了原因）

1. **playwright.config.ts 没写 `serviceWorkers: 'block'`**。SPEC 的验收表里写了这条，但同一份 SPEC 的
   E2E 清单又要求「离线（setOffline）仍能打开并记一笔」——把 SW 屏蔽掉，离线用例必然失败，两条自相矛盾。
   取舍：保留 SW（不屏蔽），因为每个用例跑在全新 browser context 里，CacheStorage 本来就是空的，
   不存在旧缓存污染；而且不屏蔽才验得了 PWA 离线。→ 离线用例在任务 4 补。
2. **webServer.command 里先 build 再 preview**（`npm run build && npx vite preview`）。
   原因：Playwright 的 preview 服务的是 `dist/`，如果忘了重新构建就会拿旧产物跑出假绿。
   把构建塞进 webServer 后，每次 E2E 都必然用到最新产物，构建失败＝测试直接起不来。
3. **加了 @types/react、@types/react-dom**（白名单外），理由见 BLOCKED.md 第 1 条。

## 下一期候选（SPEC 的 P2）
- 云同步 / 把附件写回 GitHub 仓库（带 token 走 GitHub API；`data/ports.ts` 的 StorageAdapter 口子已留好）
- 多币种与汇率
- 导出 PDF 月报
- 多人共享账本