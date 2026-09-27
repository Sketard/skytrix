# Skytrix — simulateur et duels Yu-Gi-Oh! en ligne

Deck builder, simulateur, duels PvP en temps réel sur OCGCore, replays et fork d'un replay en duel solo. Monorepo :
`back/` (API), `front/` (SPA), `duel-server/` (moteur de duel WebSocket). La documentation technique existante est
en anglais et le reste ; ce qui s'écrit de neuf suit la règle de langue du poste. **Source de vérité** = le code + ce
fichier + le document qui fait foi sur chaque sujet (table « Chantiers ») ; le moteur de duel est décrit dans
[`docs/duel/`](docs/duel/README.md). `work/` = dossier de travail (specs de chantiers, données et R&D du solveur,
captures) ; `_mockups/` = maquettes HTML, hors produit.

## Comment faire

Un outil neuf ajoute sa ligne ici. La table dit **quand** ; le **comment** vit dans la cible.

| Geste                                        | Point d'entrée                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Lancer en local                              | [`docs/development-guide.md`](docs/development-guide.md) « Run locally » ; données du moteur : [`duel-server/DATA-SETUP.md`](duel-server/DATA-SETUP.md) |
| Lancer l'e2e ou déboguer sans gêner Axel     | pile isolée `node scripts/dev-stack.mjs up` (ports décalés), puis `PW_AUTO_STACK=1 npx playwright test` dans `front/` ; [`docs/development-guide.md`](docs/development-guide.md) « Isolated dev-stack » |
| Tester une pièce                             | `front` : `npx ng test --include=<spec> --watch=false --browsers=ChromeHeadless` ; `duel-server` : `npm test` ; `back` : `mvnw test` |
| Déboguer une animation ou un replay          | [`docs/duel/debugging.md`](docs/duel/debugging.md) (`DuelLogger`, `window.__skytrixDebug`, harnais Playwright)   |
| Écrire de l'interface                        | lire d'abord [`front/DESIGN-SYSTEM.md`](front/DESIGN-SYSTEM.md) ; lints : [`front/LINTING.md`](front/LINTING.md) |
| Toucher au moteur de duel (chaîne, replay, perspective, orchestrateur) | la table de [`docs/duel/README.md`](docs/duel/README.md) dit quel document lire          |
| Ajouter une carte au score du solveur        | [`docs/development-guide.md`](docs/development-guide.md) « Adding a new card to the solver scoring »             |
| Déployer                                     | `scripts/deploy.sh` ; [`docs/deployment-guide.md`](docs/deployment-guide.md)                                    |
| Orchestrer un chantier par sous-agents       | skill `workbench:orchestrate`                                                                                    |
| Vérifier avant de finir                      | `npm run verify` à la racine                                                                                     |

## Chantiers

| Sujet                                          | État                   | Fait foi                                                                                          |
| ---------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| Moteur de duel (modes, chaîne, replay, perspective) | référence         | [`docs/duel/README.md`](docs/duel/README.md)                                                      |
| Pipeline d'animation v2 (lots α, β)            | livré, règles en vigueur | [`docs/duel/animation.md`](docs/duel/animation.md) ; détail : [`docs/anim-pipeline-v2/README.md`](docs/anim-pipeline-v2/README.md) |
| Design system du front                          | référence              | [`front/DESIGN-SYSTEM.md`](front/DESIGN-SYSTEM.md)                                                 |
| Solveur de combos (R&D)                        | en pause               | `work/solver-data/` ; ne pas l'étendre sans rouvrir la R&D                                         |
| Specs et audits des chantiers                   | voir chaque document   | `work/planning-artifacts/`                                                                         |

## Infra

- **Trois pièces** : `back/` Spring Boot 3.4 (Java 21, `mvnw`), PostgreSQL + Flyway ; `front/` Angular 21 (Karma +
  Jasmine, Playwright) ; `duel-server/` Node + OCGCore (`@n1xx1/ocgcore-wasm`), vitest.
- **Ports** : back `:8080` (`/api`) et `:8081` (actuator), duel-server `:3001`, front `:4200` ; la pile isolée les
  décale de `+10000` (Postgres `:15432`).
- **Contrôles** (`scripts/check-*.mjs`) : lancés par les `prebuild` du front et du duel-server, par le pre-commit et
  par la CI (`.github/workflows/protocol-sync.yml`).
- **Branche** `master` ; déploiement Docker Compose sur un VPS propre à skytrix.

## Garde-fous

- **Fini = `npm run verify` vert**, câblé au `pre-push`.
- **Commits** : Conventional Commits, description en français, scope par pièce ou par sujet (`anim`, `replay`,
  `build`…).
- **Documents** : un document de plus de ~100 lignes suit le skill `workbench:doc-standards`. **Règle du scout** :
  qui modifie un document fréquemment touché le met à la convention dans le même changement.
- 🚨 **Protocole WS** : un fichier `ws-protocol-*.ts` du duel-server et son miroir `duel-ws-*.types.ts` du front
  changent **dans le même commit**, octet pour octet (`check-ws-protocol-sync`).
- 🚨 **Parité d'animation** : l'orchestrateur ne passe que par `AnimationDataSource`, jamais par
  `DuelWebSocketService` ni `DuelConnection`, pour que le replay hérite de tout
  ([`docs/duel/animation.md`](docs/duel/animation.md)).
- 🚨 **Perspective** : une clé de zone porte un index de joueur **relatif** (`ctx.relativePlayer(…)`), jamais l'index
  absolu du serveur ([`docs/duel/perspective.md`](docs/duel/perspective.md)).
- **Un `inject(X)` requis ajouté** à un composant ou une directive : lancer sa spec sous Karma avant de commiter ;
  `tsc` ne voit pas l'erreur `NG0201`.
- **Interface** : composants du design system seulement, couleurs par jeton `var(--…)` ; un composant neuf s'ajoute
  à `front/DESIGN-SYSTEM.md`.
- **e2e lancé par un agent** : toujours sur la pile isolée (`PW_AUTO_STACK=1`), jamais sur les ports d'Axel.
