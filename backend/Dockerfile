# =============================================================================
#  ipa-apk-app-manager — BACKEND imaji (Fastify)
#
#  Yalnizca API (/api/*) ve OTA kurulum uclarini sunar. Admin arayuzu AYRI BIR
#  SERVISTIR (../frontend), aralarinda container-ici trafik yoktur.
#
#  DERLEME BAGLAMI BU DIZINDIR — depo koku DEGIL:
#      cd backend && docker build -t ipa-apk-api:latest .
#      cd backend && docker compose up -d --build
#
#  npm workspaces KALDIRILDI: backend'in kendi package.json + package-lock.json
#  dosyasi vardir, kok dizindeki hicbir dosyaya ihtiyac duymaz.
#
#  Debian tabanli imaj (Alpine degil): better-sqlite3 yerel bir eklenti
#  oldugundan derleme ve calisma asamalari ayni libc uzerinde olmali.
# =============================================================================

# --- 1) Bagimliliklar + derleme ----------------------------------------------
FROM node:22-bookworm-slim AS builder

# better-sqlite3'un derlenmesi icin gerekli araclar
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Once yalnizca manifest dosyalari: kaynak degistiginde npm ci yeniden
# calismasin diye katman onbellegi korunur. (Glob: lock yoksa COPY patlamasin,
# hatayi anlasilir bicimde npm ci versin.)
COPY package.json package-lock.json* ./

RUN npm ci

# Kaynak + tsconfig + .env.production. Ne kopyalandigini .dockerignore belirler
# (node_modules, dist, data-docker ve .env disarida kalir).
COPY . .

RUN npm run build

# Uretim bagimliliklarini ayikla
RUN npm prune --omit=dev


# --- 2) Calisma imaji ---------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# dumb-init: PID 1 olarak sinyalleri dogru iletir, zombi surec birakmaz
RUN apt-get update && apt-get install -y --no-install-recommends \
      dumb-init ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Tek workspace oldugu icin duz yerlesim: /app/node_modules, /app/dist.
# (Eskiden npm workspaces yuzunden /app/backend/dist ic ice duruyordu.)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist

# Uretim varsayilanlari imaja gomulur. SIR ICERMEZ — ADMIN_PASSWORD ve
# SESSION_SECRET docker compose'un `environment:` blogundan gelir ve gercek
# ortam degiskeni bu dosyadaki her degeri EZER.
COPY --from=builder /app/.env.production ./.env.production

# Veri dizini: SQLite + yuklenen IPA dosyalari. Host'a baglanmali
# (compose: ./data-docker:/data).
RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
# .env.production -> .env.local -> gercek ortam degiskeni (sonraki ezer).
# NOT: `.env` BILEREK OKUNMAZ — o dosya yalnizca docker compose'a aittir.
CMD ["node", "--env-file-if-exists=.env.production", "--env-file-if-exists=.env.local", "dist/index.js"]
