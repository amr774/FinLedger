import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_URL || 'http://127.0.0.1:8180',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_EXTERNAL
    ? undefined
    : [
        {
          command: 'node scripts/test-api.mjs',
          url: 'http://127.0.0.1:3100/api/v1/health/ready',
          reuseExistingServer: false,
          timeout: 60000,
        },
        {
          command: 'npm run dev -w @finledger/web -- --port 8180 --strictPort',
          env: { API_PROXY_TARGET: 'http://127.0.0.1:3100' },
          url: 'http://127.0.0.1:8180',
          reuseExistingServer: false,
          timeout: 60000,
        },
      ],
});
