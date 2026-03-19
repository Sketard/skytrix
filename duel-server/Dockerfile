FROM node:24-slim

RUN apt-get update && apt-get install -y curl git ca-certificates --no-install-recommends && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Scripts racine requis par le prebuild (check-ws-protocol-sync.mjs via ../scripts/)
COPY scripts/ /scripts/

# Dépendances (postinstall requiert duel-server/scripts/patch-ocgcore-wasm.mjs)
COPY duel-server/package*.json ./
COPY duel-server/scripts/ ./scripts/
RUN npm ci

# Source
COPY duel-server/ .

# Le prebuild check-ws-protocol-sync.mjs résout les chemins depuis / :
#   /duel-server/src/ws-protocol.ts  → symlink vers /app
#   /front/src/app/pages/pvp/duel-ws.types.ts → copié depuis le contexte racine
RUN ln -s /app /duel-server
COPY front/src/app/pages/pvp/duel-ws.types.ts /front/src/app/pages/pvp/duel-ws.types.ts

RUN npm run build

EXPOSE 3001

CMD ["node", "dist/server.js"]
