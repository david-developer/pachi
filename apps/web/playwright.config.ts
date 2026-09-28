import { defineConfig } from '@playwright/test';

const externalServer = process.env.PACHI_BROWSER_BASE_URL;
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: externalServer ?? 'http://localhost:3100', browserName: 'chromium' },
  webServer: externalServer ? [] : [{
    command: 'pnpm exec next start --port 3100',
    url: 'http://localhost:3100/provider',
    reuseExistingServer: false
  }]
});
