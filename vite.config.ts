import { defineConfig } from 'vite';
import { buildInfo } from './scripts/build-info.mjs';

export default defineConfig({
  base: './',
  define: { __FORM_FIELD_BUILD__: JSON.stringify(buildInfo()) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});
