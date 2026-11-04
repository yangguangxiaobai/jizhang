# jizhang — API-only container for the native Android / HarmonyOS 4 client
# (parent design.md §1/§7.1). Host reverse proxy terminates TLS and forwards to
# 127.0.0.1:8081; this image never binds 80/443.
#
# No `# syntax=` directive on purpose: nothing here needs a BuildKit frontend,
# and requiring docker/dockerfile:1 makes the build fail on registries that do
# not serve that image.

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — builder: install (with dev deps), build server/shared only
# ─────────────────────────────────────────────────────────────────────────────
# BOTH stages use the SAME base image on purpose: better-sqlite3 is a native C++
# addon, so a different Node ABI or libc between build and runtime means
# `require('better-sqlite3')` dies at container start (parent risk R1).
FROM node:22-bookworm-slim AS builder

# Optional mirror for slow networks. Apt verifies Debian's signed repository metadata;
# HTTP permits bootstrapping on the slim image, which lacks system CA certificates.
ARG DEBIAN_MIRROR=http://deb.debian.org
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.12.2 --activate

# Manifests first: the dependency layer is then reused when only source changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

# better-sqlite3 may not have a downloadable prebuild for the selected Node ABI or
# target architecture. Keep its install script enabled and provide node-gyp's
# toolchain only for this dependency-install layer; purge it before the builder layer
# is committed so the runtime image remains unaffected.
RUN case "$DEBIAN_MIRROR" in http://deb.debian.org|http://mirrors.aliyun.com) ;; *) echo 'Unsupported Debian mirror' >&2; exit 1 ;; esac \
    && sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update \
    && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install -y --no-install-recommends python3 make g++ \
    && pnpm install --frozen-lockfile --filter @jizhang/server... \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server

RUN pnpm --filter @jizhang/shared run build \
    && pnpm --filter @jizhang/server run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime: production deps + built server/shared only
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ARG DEBIAN_MIRROR=http://deb.debian.org

# 1 vCPU / 1 GB VPS: cap the heap so the container cannot trip the host OOM
# killer (parent risk table in design.md §8). PORT/DATA_DIR are the documented
# contract; compose/`-e` may override them.
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=256 \
    PORT=8081 \
    DATA_DIR=/data \
    TZ=Asia/Shanghai \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.12.2 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

# Production dependencies only, installed *in this stage* rather than copied from
# the builder: pnpm's node_modules is symlink-based, so a copied tree would point
# outside the final filesystem. This stage also rebuilds better-sqlite3. Supply
# node-gyp's compiler toolchain only while installing, then remove it from runtime.
RUN case "$DEBIAN_MIRROR" in http://deb.debian.org|http://mirrors.aliyun.com) ;; *) echo 'Unsupported Debian mirror' >&2; exit 1 ;; esac \
    && sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update \
    && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install -y --no-install-recommends python3 make g++ \
    && pnpm install --frozen-lockfile --prod --filter @jizhang/server... \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY deploy/db-manifest.mjs ./deploy/db-manifest.mjs

# /data is the mounted volume. It stays owned by `node` so the non-root runtime
# user can create the SQLite file and its WAL sidecars.
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 8081

# Reads the same endpoint the app exposes; `fetch` is a Node 22 global, so the
# runtime image needs no curl/wget installed just for the healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8081) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
