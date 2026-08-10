import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Proxy YOK — ne gelistirmede ne uretimde.
 *
 * API'nin adresi tek bir yerden gelir: derleme zamanindaki VITE_API_BASE_URL
 * (bkz. .env.development / .env.production, src/api.ts).
 *
 *   uretim      : bos  => goreli yol. Ayrimi ONDEKI ters proxy yapar
 *                 (/ -> bu SPA, /api/* -> backend). CORS gerekmez.
 *   gelistirme  : mutlak adres. Tarayici API'ye dogrudan baglanir, yani
 *                 cross-origin olur ve backend'de CORS_ORIGINS icinde
 *                 http://localhost:5173 bulunmalidir
 *                 (backend/.env.development bunu zaten ayarliyor).
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Self-hosted arac: kaynak haritalari hata ayiklamayi kolaylastirir.
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Port doluysa sessizce baskasina kaymasin: CORS_ORIGINS ile eslesmezse
    // giris calismaz, bunu erken fark etmek daha iyi.
    strictPort: true,
  },
});
