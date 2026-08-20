# =============================================================================
#  ipa-ota-download — FRONTEND imaji (nginx + statik SPA)
#
#  Yalnizca admin arayuzunu sunar. API AYRI BIR SERVISTIR (../backend) ve bu
#  imajin ondan hicbir haberi yoktur — ne derlemede ne calismada.
#
#  DERLEME BAGLAMI BU DIZINDIR — depo koku DEGIL:
#      cd frontend && docker build -t ipa-ota-web:latest .
#      cd frontend && docker compose up -d --build
#
#  npm workspaces KALDIRILDI: frontend'in kendi package.json + package-lock.json
#  dosyasi vardir, kok dizindeki hicbir dosyaya ihtiyac duymaz.
#
#  API ADRESI: uretimde GORELI YOL kullanilir (.env.production icinde
#  VITE_API_BASE_URL bostur). Yani imaj alan adindan bagimsizdir ve adres
#  degisince yeniden derlenmesi gerekmez — ONDEKI ters proxy `/api/*` yolunu
#  backend'e yonlendirdigi surece calisir.
#
#  Eski calisma zamani yapilandirmasi (/config.js + API_BASE_URL) KALDIRILDI.
# =============================================================================

# --- 1) Derleme ---------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Once yalnizca manifest dosyalari: kaynak degistiginde npm ci yeniden
# calismasin diye katman onbellegi korunur. (Glob: lock yoksa COPY patlamasin,
# hatayi anlasilir bicimde npm ci versin.)
COPY package.json package-lock.json* ./

RUN npm ci

# Kaynak + index.html + vite.config.ts + tsconfig.json + .env.production.
# Ne kopyalandigini .dockerignore belirler (node_modules, dist, .env ve
# .env.development disarida kalir).
COPY . .

# `vite build` varsayilan olarak mode=production kullanir ve .env.production
# dosyasini okur (VITE_API_BASE_URL bos => goreli yol).
RUN npm run build


# --- 2) Calisma imaji ---------------------------------------------------------
# Root olmadan calisan resmi nginx varyanti; 8080 portunu dinler.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

USER root

# Kaynak yollari artik "frontend/" oneki TASIMAZ — baglam bu dizin.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY guvenlik-basliklari.conf /etc/nginx/snippets/guvenlik-basliklari.conf

COPY --from=builder /app/dist /usr/share/nginx/html

RUN chown -R 101:101 /usr/share/nginx/html

USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
