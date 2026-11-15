import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Телефон жюри открывает страницу по адресу туннеля. cloudflared — основной путь;
// pinggy — запасной, когда сеть (или VPN на ноутбуке) не пускает cloudflared.
const TUNNEL_HOSTS = ['.trycloudflare.com', '.loca.lt', '.pinggy-free.link', '.pinggy.net', '.pinggy.online', '.serveousercontent.com', '.serveo.net'];

const API_PROXY = {
  '/api': {
    target: process.env.VITE_API_URL ?? 'http://localhost:3001',
    changeOrigin: true,
  },
};

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      // React стоит в apps/web/node_modules; веб-модули лежат вне apps/web и без этих
      // псевдонимов не найдут пакет. Новых зависимостей не добавляем.
      'react-dom': fileURLToPath(new URL('./node_modules/react-dom', import.meta.url)),
      react: fileURLToPath(new URL('./node_modules/react', import.meta.url)),
      '@ugra/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
      // Полный @ugra/core тянет node:crypto — в браузер берём только веб-часть.
      '@ugra/core/web': fileURLToPath(new URL('../../packages/core/src/web.ts', import.meta.url)),
      '@ugra/ui/tokens.css': fileURLToPath(new URL('../../packages/ui/src/tokens.css', import.meta.url)),
      '@ugra/ui/styles.css': fileURLToPath(new URL('../../packages/ui/src/styles.css', import.meta.url)),
      '@ugra/ui': fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    allowedHosts: TUNNEL_HOSTS,
    proxy: API_PROXY,
  },
  // Телефону через туннель отдаём собранную версию (`pnpm demo:tunnel`): 5 файлов вместо ~190
  // модулей dev-сервера — страница звонка открывается сразу, без переподключений HMR.
  preview: {
    port: 4173,
    strictPort: true,
    allowedHosts: TUNNEL_HOSTS,
    proxy: API_PROXY,
  },
  build: {
    outDir: 'dist',
  },
});
