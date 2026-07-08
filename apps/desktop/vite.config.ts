import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  resolve: {
    alias: {
      '@frogword/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@frogword/storage': fileURLToPath(new URL('../../packages/storage/src/index.ts', import.meta.url)),
    },
  },
});
