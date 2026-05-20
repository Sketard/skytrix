FROM node:24-slim

RUN apt-get update && apt-get install -y curl git ca-certificates --no-install-recommends && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Scripts racine requis par le prebuild (check-ws-protocol-sync.mjs via ../scripts/)
COPY scripts/ /scripts/

# Dépendances (postinstall requiert duel-server/scripts/patch-ocgcore-wasm.mjs)
# P4 patch lit data/scripts_full/proc_workaround.lua → copier avant npm ci
COPY duel-server/package*.json ./
COPY duel-server/scripts/ ./scripts/
COPY duel-server/data/scripts_full/ ./data/scripts_full/
RUN npm ci

# Source
COPY duel-server/ .

# Le prebuild check-ws-protocol-sync.mjs résout les chemins depuis / :
#   /duel-server/src/ws-protocol-*.ts        → symlink vers /app
#   /front/src/app/pages/pvp/duel-ws-*.types.ts → copiés depuis le contexte racine
# Le protocole a été splitté en 6 sous-fichiers (shared/game/prompts/system/
# replay/solver) — le script byte-compare ces 6 paires, PAS les index.
RUN ln -s /app /duel-server
COPY front/src/app/pages/pvp/duel-ws-shared.types.ts \
     front/src/app/pages/pvp/duel-ws-game.types.ts \
     front/src/app/pages/pvp/duel-ws-prompts.types.ts \
     front/src/app/pages/pvp/duel-ws-system.types.ts \
     front/src/app/pages/pvp/duel-ws-replay.types.ts \
     front/src/app/pages/pvp/duel-ws-solver.types.ts \
     /front/src/app/pages/pvp/

RUN npm run build

EXPOSE 3001

CMD ["node", "dist/server.js"]
