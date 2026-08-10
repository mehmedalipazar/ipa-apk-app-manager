# =============================================================================
#  ipa-ota-download — backend imaji (Fastify)
#
#  Yalnizca API (/api/*) ve OTA kurulum uclarini sunar. Admin arayuzu ayri bir
#  imajdadir (frontend/Dockerfile) ve aralarinda container-ici trafik yoktur.
#
#  Derleme baglami depo koku olmalidir — npm workspaces kok package.json ve
#  package-lock.json'a ihtiyac duyar:
#      docker build -f backend/Dockerfile .
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
# calismasin diye katman onbellegi korunur.
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci

COPY tsconfig.base.json ./
COPY backend ./backend

RUN npm run build --workspace=backend

# Uretim bagimliliklarini ayikla
RUN npm prune --omit=dev


# --- 2) Calisma imaji ---------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# dumb-init: PID 1 olarak sinyalleri dogru iletir, zombi surec birakmaz
RUN apt-get update && apt-get install -y --no-install-recommends \
      dumb-init ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# npm workspaces bagimliliklari kok node_modules'a toplar (hoisting);
# backend/ altinda ayri bir node_modules olusmaz. Node, /app/backend/dist'ten
# yukari yuruyerek /app/node_modules'i bulur.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/backend/dist ./backend/dist

# Uretim varsayilanlari imaja gomulur. SIR ICERMEZ — ADMIN_PASSWORD ve
# SESSION_SECRET docker compose'un `environment:` blogundan gelir ve gercek
# ortam degiskeni bu dosyadaki her degeri EZER.
COPY --from=builder /app/backend/.env.production ./backend/.env.production

# Veri dizini: SQLite + yuklenen IPA dosyalari. Host'a baglanmali.
RUN mkdir -p /data && chown -R node:node /data /app

USER node
WORKDIR /app/backend

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
# .env.production -> .env.local -> gercek ortam degiskeni (sonraki ezer)
CMD ["node", "--env-file-if-exists=.env.production", "--env-file-if-exists=.env.local", "dist/index.js"]
