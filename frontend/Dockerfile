# =============================================================================
#  ipa-ota-download — admin arayuzu imaji (nginx + statik SPA)
#
#  Derleme baglami depo koku olmalidir — npm workspaces kok package.json ve
#  package-lock.json'a ihtiyac duyar:
#      docker build -f frontend/Dockerfile .
#
#  API ADRESI: uretimde GORELI YOL kullanilir (frontend/.env.production icinde
#  VITE_API_BASE_URL bostur). Yani imaj alan adindan bagimsizdir ve adres
#  degisince yeniden derlenmesi gerekmez — ONDEKI ters proxy `/api/*` yolunu
#  backend'e yonlendirdigi surece calisir.
#
#  Eski calisma zamani yapilandirmasi (/config.js + API_BASE_URL) KALDIRILDI.
# =============================================================================

# --- 1) Derleme ---------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Yalnizca frontend workspace'inin bagimliliklari — backend'in yerel eklentileri
# (better-sqlite3) burada derlenmesin diye.
RUN npm ci --workspace=frontend --include-workspace-root

COPY tsconfig.base.json ./
COPY frontend ./frontend

# `vite build` varsayilan olarak mode=production kullanir ve
# frontend/.env.production dosyasini okur (VITE_API_BASE_URL bos => goreli yol).
RUN npm run build --workspace=frontend


# --- 2) Calisma imaji ---------------------------------------------------------
# Root olmadan calisan resmi nginx varyanti; 8080 portunu dinler.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

USER root

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/guvenlik-basliklari.conf /etc/nginx/snippets/guvenlik-basliklari.conf

COPY --from=builder /app/frontend/dist /usr/share/nginx/html

RUN chown -R 101:101 /usr/share/nginx/html

USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
