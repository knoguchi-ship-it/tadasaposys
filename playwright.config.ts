/**
 * Playwright 設定 — タダサポ管理システム v1.11.4
 * 参考: https://playwright.dev/docs/test-configuration
 * ベストプラクティス準拠 (Playwright 1.52.0 / 2026基準)
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir:       './tests/e2e',
  fullyParallel: false,  // ローカルサーバー共有のため順次実行
  forbidOnly:    !!process.env.CI,
  retries:       process.env.CI ? 2 : 0,
  workers:       1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL:    'http://localhost:3000',
    locale:     'ja-JP',
    timezoneId: 'Asia/Tokyo',

    // 失敗時のみアーティファクト収集
    trace:      'on-first-retry',
    screenshot: 'only-on-failure',
    video:      'retain-on-failure',

    // Babel in-browser の初期化に余裕を持たせる
    actionTimeout:     15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      // GAS はChrome前提のため Chromium のみテスト
      name: 'chromium',
      use:  { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command:              'npx serve -s . -l 3000',
    url:                  'http://localhost:3000',
    reuseExistingServer:  !process.env.CI,
    timeout:              30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
