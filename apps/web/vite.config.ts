import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const uiRoot = fileURLToPath(new URL('../../packages/ui/src/', import.meta.url));
const local = (pkg: string): string => fileURLToPath(new URL(`node_modules/${pkg}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@ugra/ui/tokens.css': `${uiRoot}tokens.css`,
      '@ugra/ui/styles.css': `${uiRoot}styles.css`,
      '@ugra/ui': `${uiRoot}index.ts`,
      '@ugra/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
      // Полный @ugra/core тянет node:crypto — в браузер берём только веб-часть.
      '@ugra/core/web': fileURLToPath(new URL('../../packages/core/src/web.ts', import.meta.url)),
      // Веб-модули и @ugra/ui лежат вне apps/web: React берём из установленных зависимостей веба.
      react: local('react'),
      'react-dom': local('react-dom'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
