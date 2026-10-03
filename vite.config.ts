/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` makes the build work from any GitHub Pages sub-path
// (https://<user>.github.io/<repo>/) without configuration. Navigation uses
// the URL hash, so no server-side rewrites are required.
/**
 * Production-only Content-Security-Policy: scripts only from this site, and
 * network calls only to Google Apps Script (the Sheets backend). It is not
 * applied in `npm run dev` because the dev server relies on inline scripts.
 */
const CSP =
  "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; " +
  "connect-src 'self' https://script.google.com https://script.googleusercontent.com; " +
  "object-src 'none'; base-uri 'self'; form-action 'none'";

const cspPlugin = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  base: './',
  plugins: [react(), cspPlugin()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
