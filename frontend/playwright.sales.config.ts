import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'sales.spec.ts',fullyParallel:false,workers:1,outputDir:'test-results-sales',
  use:{baseURL:'http://127.0.0.1:3212',trace:'retain-on-failure'},
  webServer:[
    {command:'python ../backend/tests/sale_browser_server.py',env:{RK_SALE_BROWSER_FIXTURE:'1'},url:'http://127.0.0.1:5165/api/sales/public',timeout:30000,reuseExistingServer:false},
    {command:'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3212',env:{BACKEND_INTERNAL_URL:'http://127.0.0.1:5165'},url:'http://127.0.0.1:3212/account',timeout:60000,reuseExistingServer:false},
  ],
});
