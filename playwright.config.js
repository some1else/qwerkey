import { defineConfig } from '@playwright/test';
const base = process.env.QWERKEY_BASE || '/';
export default defineConfig({
  testDir: './tests',
  use: { channel: 'chromium', baseURL: `http://127.0.0.1:4173${base}` },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --ignore-lock',
    url: `http://127.0.0.1:4173${base}`,
  },
});
