import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 正式環境由 Express 於 /liff/ 提供靜態檔（P8.3）；開發時 /api 與 /liff/config.json 代理到後端 3000
export default defineConfig({
  base: '/liff/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/liff/config.json': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
