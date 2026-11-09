import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60000,
  webServer: {
    command: 'npx http-server . -a 127.0.0.1 -p 4173 -c-1 --silent',
    url: 'http://127.0.0.1:4173/tests/fixtures/plain.html',
    reuseExistingServer: true,
  },
});
