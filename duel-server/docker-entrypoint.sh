#!/bin/sh
# Entrypoint du duel-server.
#
# /app/data est un volume nommé (duel_data) : Docker ne le remplit depuis
# l'image qu'à sa création, donc les fichiers de config ajoutés ou modifiés
# dans le repo n'y arrivaient jamais après le premier déploiement (solver
# désactivé puis crash loop sur interruption-weights.json manquant).
#
# Les fichiers de config versionnés (data/*.json, data/archetype-expertise/)
# sont donc embarqués dans /app/data-defaults et recopiés à chaque démarrage,
# en écrasant la copie du volume. Le volume ne garde que ce qui est produit à
# l'exécution : cards.cdb, strings.conf, scripts_full/ (via /api/update-data)
# et training-logs/.
set -e

mkdir -p /app/data
cp -R /app/data-defaults/. /app/data/

exec "$@"
