import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const isPagesBuild = process.env.VITE_FROGWORD_TARGET === 'pages';

// Тексты лицензий едут вместе со сборкой — в веб-версию (docs/licenses/) и в окно приложения.
// Лицензии пакетов npm, которые попали в бандл, пишет сам Vite (build.license); этот плагин кладёт
// рядом то, что приходит не из npm: лицензию FrogWord, маскота из Noto Emoji и шрифта Cygre.
const LICENSE_FILES: Array<[string, string]> = [
  ['../../LICENSE', 'licenses/FrogWord-LICENSE.txt'],
  ['src/mascot/NotoEmoji-LICENSE.txt', 'licenses/NotoEmoji-LICENSE.txt'],
  ['src/assets/fonts/cygre/Cygre-EULA.pdf', 'licenses/Cygre-EULA.pdf'],
];

function licenseFiles(): Plugin {
  return {
    name: 'frogword:license-files',
    apply: 'build',
    generateBundle() {
      for (const [from, fileName] of LICENSE_FILES) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(new URL(from, import.meta.url)) });
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), licenseFiles()],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: isPagesBuild ? '../../docs' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
    license: { fileName: 'licenses/npm-packages.md' },
  },
  resolve: {
    alias: {
      '@frogword/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@frogword/storage': fileURLToPath(new URL('../../packages/storage/src/index.ts', import.meta.url)),
    },
  },
});
