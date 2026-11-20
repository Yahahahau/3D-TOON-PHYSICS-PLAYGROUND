import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    // built game goes to docs/ so GitHub Pages can serve it (Settings → Pages → /docs)
    outDir: 'docs',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
