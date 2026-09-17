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

## 数据在哪

全部在浏览器的 IndexedDB（库名 `cute-ledger`）里：流水、附件二进制、分类、设置。
**换设备/清缓存前请先到「设置 → 备份与恢复」导出 zip。**

想跨设备同步的话，见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 里的扩展点 3——
存储层是接口化的，加一个云端适配器即可，界面不用改。

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) —— 分层、目录、**怎么加一个新功能**
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) —— 表结构、字段、迁移规则