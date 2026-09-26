import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: { baseURL: 'http://localhost:3102', browserName: 'chromium' },
  webServer: {
    command: 'pnpm exec next start --port 3102',
    url: 'http://localhost:3102',
    reuseExistingServer: false,
  },
});
