# 数据模型

IndexedDB 库名 `cute-ledger`，当前版本 `DB_VERSION = 2`（见 `src/data/migrations.ts`）。
v1 → v2 只做了一件事：给分类补 `updatedAt`（跨设备同步要判断「谁最后改的」）。

## 表

### expenses（流水）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 主键，`crypto.randomUUID()` |
| `amountCents` | int | **整数「分」**，`1234` = 12.34 元 |
| `categoryId` | string | 指向 categories |
| `note` | string | 备注，可为空 |
| `tags` | string[] | 标签，最多 10 个、每个 ≤12 字 |
| `spentAt` | string | `'YYYY-MM-DD'`（本地日期，不是 UTC） |
| `createdAt` / `updatedAt` | string | ISO 时间戳 |
| `attachmentIds` | string[] | 指向 attachments |

索引：`spentAt`、`categoryId`

### attachments（附件）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 主键 |
| `expenseId` | string | 归属流水，删流水会级联删附件 |
| `kind` | `'image' \| 'video'` | |
| `blob` | Blob | 二进制本体（图片已压缩） |
| `mime` | string | `image/webp` / `video/mp4` … |
| `width` / `height` | number? | 图片尺寸 |
| `sizeBytes` | number | 体积，用于显示和统计 |
| `createdAt` | string | ISO |

索引：`expenseId`

### categories（分类）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 内置 12 个用 `cat-*`，自定义用 `cat-<uuid>` |
| `name` / `emoji` / `color` | string | 显示用 |
| `order` | number | 排序 |
| `monthlyBudgetCents` | int? | 分类月预算，可为空 |
| `archived` | boolean | 归档后不出现在记账选择器，历史流水仍正常显示 |
| `createdAt` | string | ISO |

索引：`order`

### settings（设置，单条记录，key = `app`）

**跨设备共享的**：`currencySymbol` / `theme` / `mode` / `weekStart` / `monthlyBudgetCents` / `updatedAt`
**每台设备自己的**（不参与同步，也不会推到云端）：`lastBackupAt` / `persisted` / `syncRepo` / `syncBranch` / `syncEnabled` / `lastSyncAt`

### meta（杂项键值）

- `schemaVersion`：表结构版本
- `syncTombstones`：删除墓碑 `{ id: 删除时间 }`，同步用，90 天后自动清理
- `syncToken`：数据仓库的 token。**故意放在这里**——`dump()` 不读 meta，所以导出备份 zip 时不会把密钥带出去

### meta（元信息）

`schemaVersion`：当前表结构版本。迁移时按 `oldVersion+1 → newVersion` 顺序执行 `migrations` 表里的函数。

## 迁移规则

改表结构时：

1. `DB_VERSION` 加 1
2. `migrations` 里加同号函数，只写「从上一版到本版」要做的改动
3. `migrations.test.ts` 里加一条断言（表/索引/字段）

**老迁移函数一个字都不许改**——它们负责把老用户的数据库升上来。删掉或改掉会让老数据读不出来。

`settings` 读取时用 `{...DEFAULT_SETTINGS, ...存储值}` 合并，所以以后给设置加字段，
老数据读出来会自动补默认值，不需要迁移。

## 同步用的远端格式（私有数据仓库里）

```
state.json              整份元数据快照：
                        { schemaVersion, generatedAt, expenses[], categories[],
                          attachments[](不含二进制), settings(只含共享字段), tombstones{} }
media/<附件id>.<后缀>    附件二进制本体
```

推送用 Git Data API 一次提交搞定（blob → tree → commit → 更新 ref），删除文件靠 tree 里 `sha: null`。
空仓库有坑：首个提交必须走 Contents API，否则 Git Data API 一律 409 Git Repository is empty
（`scripts/sync-probe.mjs` 实测确认，`src/services/sync/github.test.ts` 把这条固化成回归测试）。

## 备份格式（导出 zip）

```
manifest.json   { app: 'cute-ledger', format: 1, schemaVersion, exportedAt, counts }
data.json       { schemaVersion, exportedAt, expenses[], attachments[](无 blob，含 file 路径), categories[], settings }
media/<附件id>.<后缀>   附件二进制原文件
```

导入时按 `attachments[].file` 去 zip 里找二进制；找不到就跳过那个附件（不写入坏记录）。
导入模式：`merge`（按 id 覆盖）或 `replace`（先清空，且导入前会自动先导出一份当前数据）。