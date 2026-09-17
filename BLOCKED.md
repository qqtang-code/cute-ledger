# BLOCKED · 待裁决清单

## 需要追认（已按默认继续做，不阻塞）

### 1. 加了两个白名单外的依赖：@types/react、@types/react-dom
- 情况：任务书允许的依赖列表里没有这两个包。
- 为什么还是装了：SPEC 指定技术栈是 React + TypeScript，而 React 19 不自带类型声明，
  没有这两个包 `npx tsc --noEmit` 必然报 `Cannot find module 'react'` 之类的一堆错，
  直接违反完成条件里的「tsc 退出码 0」。
- 影响：纯开发期类型声明，不进产物、不影响体积。
- 请领导追认；若不追认，替代方案是把 TypeScript 换成 JavaScript（会丢掉全部类型检查，不建议）。
- 版本：见 package.json（^19.2.0）。

## 无其他阻塞