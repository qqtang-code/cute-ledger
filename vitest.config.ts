import { defineConfig } from 'vitest/config'

// 单测跑在 node 环境；需要 DOM 的用例在文件顶部加 `// @vitest-environment jsdom`
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
    globals: false,
    restoreMocks: true,
  },
})