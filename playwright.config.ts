import { defineConfig } from '@playwright/test'

const BASE_URL = 'http://localhost:4173/cute-ledger/'

// 说明（写死，换会话别再改）：
// - webServer 里先 build 再 preview：跑 E2E 一定用的是刚构建的产物，不会拿旧 dist 假绿。
// - channel: 'chrome' 复用本机 Chrome 153，不下载 Playwright 浏览器。
// - 不 block Service Worker：R11 的离线用例需要真 SW 生效；每个用例是全新 context，
//   CacheStorage 本来就是空的，不存在旧缓存污染。
const mobile = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
}

const desktop = {
  viewport: { width: 1280, height: 800 },
  hasTouch: false,
  isMobile: false,
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...mobile } },
    { name: 'desktop', use: { ...desktop } },
  ],
  webServer: {
    // 一定先构建：防止拿旧产物跑出假绿
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
  },
})