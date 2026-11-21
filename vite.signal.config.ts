import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const project = import.meta.dirname;
const notices = ['three', 'fflate', 'mediapipe-tasks-vision', 'selfie-multiclass-model', 'webgl-fluid-simulation'];

export default defineConfig({
  root: resolve(project, 'signal-melt'),
  base: './',
  publicDir: resolve(project, 'public'),
  server: { host: '127.0.0.1', port: 5174, strictPort: true, fs: { allow: [project] } },
  preview: { host: '127.0.0.1', port: 5174, strictPort: true },
  build: {
    target: 'es2022',
    outDir: resolve(project, 'work/signal-melt-web'),
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    rolldownOptions: { output: { format: 'iife', codeSplitting: false } },
  },
  plugins: [{
    name: 'signal-melt-static-page',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      const entry = Object.values(bundle).find(chunk => chunk.type === 'chunk' && chunk.isEntry);
      const style = Object.values(bundle).find(asset => asset.type === 'asset' && asset.fileName.endsWith('.css'));
      if (html?.type !== 'asset' || entry?.type !== 'chunk' || style?.type !== 'asset') {
        throw new Error('Signal Melt must build as one HTML page with one script and one stylesheet.');
      }

      // Inline the player so the demo also works when the HTML is opened from disk.
      // The camera model remains an on-demand download from the same host.
      const script = entry.code.replace(/<\/script/gi, '<\\/script');
      const hash = createHash('sha256').update(script).digest('base64');
      html.source = html.source.toString()
        .replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/, '')
        .replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/, () => `<style>${style.source}</style>`)
        .replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`)
        .replace('</body>', () => `<script>${script}</script>\n</body>`);
      delete bundle[entry.fileName];
      delete bundle[style.fileName];

      for (const name of notices) {
        const file = `${name}-LICENSE.txt`;
        const source = await readFile(resolve(project, 'build/notices', file), 'utf8');
        this.emitFile({ type: 'asset', fileName: `notices/${file}`, source });
      }
    },
  }],
});
