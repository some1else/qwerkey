import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: { channel: 'chromium', baseURL: 'http://127.0.0.1:4173/qwerkey/' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --base /qwerkey/',
    url: 'http://127.0.0.1:4173',
  },
});
