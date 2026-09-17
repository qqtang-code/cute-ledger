# 数据模型

IndexedDB 库名 `cute-ledger`，当前版本 `DB_VERSION = 1`（见 `src/data/migrations.ts`）。

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

`currencySymbol` / `theme` / `mode` / `weekStart` / `monthlyBudgetCents` / `lastBackupAt` / `persisted`

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

## 备份格式（导出 zip）

```
manifest.json   { app: 'cute-ledger', format: 1, schemaVersion, exportedAt, counts }
data.json       { schemaVersion, exportedAt, expenses[], attachments[](无 blob，含 file 路径), categories[], settings }
media/<附件id>.<后缀>   附件二进制原文件
```

导入时按 `attachments[].file` 去 zip 里找二进制；找不到就跳过那个附件（不写入坏记录）。
导入模式：`merge`（按 id 覆盖）或 `replace`（先清空，且导入前会自动先导出一份当前数据）。