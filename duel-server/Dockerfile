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
# Le script byte-compare 9 paires : 6 sous-fichiers protocole (shared/game/
# prompts/system/replay/solver), 2 fichiers game-log (game-log/) et
# ocgcore-reason-flags (duel-page/), PAS les index. Copier les 9 fronts.
RUN ln -s /app /duel-server
COPY front/src/app/pages/pvp/duel-ws-shared.types.ts \
     front/src/app/pages/pvp/duel-ws-game.types.ts \
     front/src/app/pages/pvp/duel-ws-prompts.types.ts \
     front/src/app/pages/pvp/duel-ws-system.types.ts \
     front/src/app/pages/pvp/duel-ws-replay.types.ts \
     front/src/app/pages/pvp/duel-ws-solver.types.ts \
     /front/src/app/pages/pvp/
COPY front/src/app/pages/pvp/game-log/game-log-types.ts \
     front/src/app/pages/pvp/game-log/game-log-builder.ts \
     /front/src/app/pages/pvp/game-log/
COPY front/src/app/pages/pvp/duel-page/ocgcore-reason-flags.ts \
     front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts \
     front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts \
     /front/src/app/pages/pvp/duel-page/

RUN npm run build

# Config versionnée du solver, recopiée dans le volume /app/data à chaque
# démarrage par docker-entrypoint.sh (voir le commentaire dans ce script).
COPY duel-server/data/*.json /app/data-defaults/
COPY duel-server/data/archetype-expertise/ /app/data-defaults/archetype-expertise/
COPY duel-server/docker-entrypoint.sh /usr/local/bin/skytrix-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/skytrix-entrypoint.sh && \
    chmod +x /usr/local/bin/skytrix-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["skytrix-entrypoint.sh"]
CMD ["node", "dist/server.js"]
