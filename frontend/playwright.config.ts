import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['search.spec.ts', 'whatsapp-ui.spec.ts', 'product-detail.spec.ts', 'manual-payments.spec.ts'],
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:3210',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3210',
    url: 'http://127.0.0.1:3210/account',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
