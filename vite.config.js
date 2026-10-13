import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE || '/',
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  test: { include: ['test/**/*.test.js'] },
});
