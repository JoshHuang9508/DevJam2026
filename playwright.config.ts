import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    // 只在本機重用既有伺服器。無條件 true 會讓測試靜默地對著 port 3000 上
    // 任何殘留行程跑——陳舊的、別的專案的、上一個 task 漏關的——而不是待測程式碼，
    // 且 Playwright 只會關閉自己啟動的伺服器，那個殘留的會繼續留著。
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
