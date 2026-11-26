import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests', testMatch:['search.spec.ts','product-detail.spec.ts'], fullyParallel:false, workers:1,
  outputDir:process.env.RK_SEARCH_TEST_OUTPUT || 'test-results-search',
  use:{baseURL:'http://127.0.0.1:3213',trace:'retain-on-failure'},
  webServer:[
    {command:'python ../backend/tests/search_browser_server.py',env:{RK_SEARCH_BROWSER_FIXTURE:'1'},url:'http://127.0.0.1:5166/api/catalog/products',timeout:30000,reuseExistingServer:false},
    {command:'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3213',env:{BACKEND_INTERNAL_URL:'http://127.0.0.1:5166'},url:'http://127.0.0.1:3213/account',timeout:60000,reuseExistingServer:false},
  ],
});
