# 可爱记账本

自用的记账 PWA：手机上打开就能记一笔、翻历史、看照片。数据存在本机浏览器（IndexedDB），
不上传任何服务器；随时能导出 zip 备份。

线上地址：<https://qqtang-code.github.io/cute-ledger/>

## 功能

- **记一笔**：金额、分类（emoji 大按钮）、日期、备注、标签，三步记完
- **附件**：图片自动压缩（长边 ≤1600px、WebP、目标 ≤800KB）、视频 ≤25MB，最多 9 图 + 1 视频
- **历史**：按天分组、上滑翻页、关键词搜索、分类/日期/金额/有无附件筛选
- **统计**：区间合计、日均、分类占比环形图、每日柱状趋势、环比
- **预算**：月度总预算 + 分类预算，80% 变黄、超支变红
- **分类管理**：增删改、排序；有流水引用的分类自动转「归档」不硬删
- **备份**：导出 zip（含附件原图）/ 导入（合并或覆盖）/ 导出 CSV
- **PWA**：可加到手机主屏，断网也能打开和记账
- **可爱风**：三套马卡龙配色 + 深色模式，大圆角、柔和阴影、内联 SVG 插画

## 开发

```bash
npm install
npm run dev        # 本地开发
npm test           # 单测（vitest）
npm run e2e        # 端到端（Playwright，用系统 Chrome）
npm run build      # 类型检查 + 构建
npm run preview    # 预览构建产物：http://localhost:4173/cute-ledger/
```

E2E 会先构建再预览，所以跑的永远是最新产物。

部署之后可以打线上地址做一次真浏览器冒烟：

```bash
node scripts/live-smoke.mjs          # 默认打 GitHub Pages 地址
GH_TOKEN=xxx node scripts/sync-probe.mjs   # 验一下数据仓库和 token 通不通
LIVE_URL=http://localhost:4173/cute-ledger/ node scripts/live-smoke.mjs
```

它会以手机视口打开、记一笔、刷新验证持久化、打开统计页，并检查有没有页面报错。

## 数据在哪

全部在浏览器的 IndexedDB（库名 `cute-ledger`）里：流水、附件二进制、分类、设置。
**换设备/清缓存前请先到「设置 → 备份与恢复」导出 zip。**

## 跨设备同步（手机记的，电脑也能看）

支持把数据同步到一个**私有 GitHub 数据仓库**（`qqtang-code/cute-ledger-data`），
手机、电脑各连同一个仓库就互通了，照片视频一起同步；断网照常记账，联网自动补传。

配置只需要一个 token，步骤见 **[docs/SYNC.md](docs/SYNC.md)**。

同步的实现要点：本地优先（IndexedDB 是主库，云端是副本）、同一条记录按 `updatedAt` 最后写入者赢、
删除留墓碑（90 天）防止旧副本复活、附件按 id 增量上传、token 只存本机且不进备份导出。
存储层仍走 `StorageAdapter` 契约，见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 扩展点 3。

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) —— 分层、目录、**怎么加一个新功能**
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) —— 表结构、字段、迁移规则
- [docs/SYNC.md](docs/SYNC.md) —— 跨设备同步怎么配、怎么排错