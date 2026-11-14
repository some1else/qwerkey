import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  output: 'static',
  site: 'https://qwerkey.xyz',
  base: process.env.QWERKEY_BASE || '/',
});
