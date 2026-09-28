import { defineConfig } from '@playwright/test';
const externalServer = process.env.PACHI_BROWSER_BASE_URL;
export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: { baseURL: externalServer ?? 'http://localhost:3102', browserName: 'chromium' },
  webServer: externalServer ? [] : {
    command: 'pnpm exec next start --port 3102',
    url: 'http://localhost:3102',
    reuseExistingServer: false,
  },
});
