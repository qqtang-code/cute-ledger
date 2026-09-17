# 架构说明

## 一句话

端口-适配器分层：**界面只调状态，状态只调用例，用例只调存储接口，存储接口背后才是 IndexedDB**。
将来把存储换成云端，界面一行都不用改。

```
app → ui → store → services → data(ports) → domain
```

依赖只能从左往右。反向 import 会被 `src/architecture.test.ts` 拦住，跑 `npm test` 就会红。

## 目录与职责

| 目录 | 干什么 | 不许干什么 |
|---|---|---|
| `src/domain/` | 纯函数：金额（整数分）、日期、统计、预算、附件规则、CSV、筛选、上传准入 | 不许 import 任何外部包；不许读时钟（`Date.now`）；不许碰浏览器 API |
| `src/data/` | `ports.ts` 定义存储契约；`migrations.ts` 管表结构版本；`adapters/indexeddb.ts` 是**唯一** `import 'idb'` 的文件；`repository.ts` 回答业务问题 | 不许 import react |
| `src/services/` | 用例编排：记账、附件压缩、备份导入导出 | 不许 import ui / react |
| `src/store/` | zustand 状态，只调 services | 不许直接开数据库 |
| `src/ui/` | 组件与页面，按功能切片分目录 | 不许 `import 'idb'`，不许 import `data/adapters` |
| `src/app/` | 路由表、布局、入口 | 同上 |
| `e2e/` | Playwright 端到端用例 | — |

## 四个扩展点（加功能照这个走）

### 1. 给流水加个字段

1. `src/domain/types.ts` 改类型
2. `src/data/migrations.ts`：`DB_VERSION` +1，加一个同号迁移函数（老数据升级用）
3. 加一条「旧版本数据能升上来」的单测

老迁移函数**一个字都不许改**——老用户的数据库要靠它升级。

### 2. 加一个页面

1. 新建 `src/ui/features/<新功能>/XxxPage.tsx`
2. `src/app/routes.tsx` 加一行（`path / label / icon / Page`）
3. 底部导航自动多一项（导航是按路由表渲染的）

### 3. 换存储 / 接云同步（比如把附件写回 GitHub 仓库）

1. 在 `src/data/adapters/` 新建一个适配器，实现 `src/data/ports.ts` 的 `StorageAdapter`
2. 在 `src/data/adapters/index.ts` 注册
3. 界面、services、store 都不用动

`StorageAdapter` 的每个方法都是业务语义（`queryExpenses` / `dump` / `bulkPut`…），
所以云端适配器只需要把同样的语义映射到 HTTP 接口。

### 4. 加统计口径

1. `src/domain/stats.ts` 加纯函数（记得处理空数据，别返回 NaN）
2. 加单测
3. 页面只做展示

## 几个刻意的设计决定

- **金额一律整数分**（`100` = 1 元）。浮点存钱迟早出现 `0.30000000000000004`。
  解析、格式化、求和全部走 `domain/money.ts`。
- **不引图表库**。环形图和柱状图是手写 SVG（`ui/components/Charts.tsx` + `domain/stats.ts` 里算角度），
  手机包体只有 250KB 左右；引一个图表库要翻倍。
- **HashRouter**。GitHub Pages 是静态托管，子路径下用 hash 路由刷新才不会 404。
- **`base: '/cute-ledger/'` 写死**。线上是 `https://<user>.github.io/cute-ledger/`，
  `vite preview` 也会在同一个子路径下起服务，本地就能仿真线上路径。
- **E2E 先构建再预览**。Playwright 的 webServer 命令是 `npm run build && vite preview`，
  防止忘了重新构建、拿旧产物跑出假绿。