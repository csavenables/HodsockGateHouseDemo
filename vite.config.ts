import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: {
    // Keep splat-transform out of Vite prebundle to preserve its import.meta.url wasm resolution.
    exclude: ['@playcanvas/splat-transform'],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
