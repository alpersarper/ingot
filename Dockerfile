# The Ingot panel, in one container on one port.
#
# The build stage installs the whole workspace, builds the panel and bundles the
# server; the runtime stage carries the two build outputs plus better-sqlite3,
# which is the only dependency that survives bundling (it is a native module).
#
# Node 22 on Debian slim rather than Alpine: better-sqlite3 publishes glibc
# prebuilds, and an Alpine base would mean compiling SQLite from source on every
# build for no gain.

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# better-sqlite3 has no prebuild for every Node patch release, so the build
# stage carries a toolchain and compiles it. Only the compiled artefact is
# copied forward, so the runtime image stays free of compilers.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Dependencies first, so a source-only change does not reinstall the world.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/panel/package.json apps/panel/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @ingot/panel build && pnpm --filter @ingot/server build

# better-sqlite3 is external to the server bundle, so the runtime needs the real
# package. `pnpm deploy` resolves the workspace symlinks into a plain tree that
# a runtime stage can copy.
RUN pnpm --filter @ingot/server --prod --legacy deploy /runtime


FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    INGOT_PORT=4310 \
    INGOT_HOST=0.0.0.0 \
    INGOT_DATA_DIR=/data \
    INGOT_PANEL_DIR=/app/panel
WORKDIR /app

COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./server
COPY --from=build /app/apps/panel/dist ./panel

# The data volume holds the SQLite database, the screenshots and the pairing
# token. It is the only thing worth backing up.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
USER node
EXPOSE 4310

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.INGOT_PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
