# Moteur de duel — où vit chaque règle

**Lecture** : l'architecture du moteur de duel de skytrix (pipeline d'animation du front, duel-server, replay),
sortie de l'ancien `CLAUDE.md` le jour de l'adoption du plugin `workbench`, texte déplacé tel quel (en anglais).
Ouvrir le document du sujet d'après la table ; chaque document long s'ouvre sur son sommaire et se lit par sections
(`Grep "^## "`, puis `Read` par plage).

| Quand on touche…                                                                                   | Lire                                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| un mode de duel (PvP, solo multiplex, fork-solo, replay), les drapeaux `soloMode`/`forkMode`        | [`modes.md`](modes.md)                   |
| les événements de chaîne, `chainPhase`, la synchro du plateau après coût                           | [`chain.md`](chain.md)                   |
| le cycle de vie de `DuelConnection`, l'amorçage                                                    | [`transport.md`](transport.md)           |
| une animation, `AnimationDataSource`, l'EventStream, les projections, les processeurs              | [`animation.md`](animation.md)           |
| le lecteur de replay, `MockDuelConnection`, la parité d'état du plateau, seek/pause, la fin du polling | [`replay.md`](replay.md)             |
| un index de joueur, une clé de zone, le relativiseur                                               | [`perspective.md`](perspective.md)       |
| l'intérieur d'`AnimationOrchestratorService` : trajets de cartes, verrou des handlers, rejeu du tampon, PV, timeline, constantes | [`orchestrator.md`](orchestrator.md) |
| les journaux, `window.__skytrixDebug`, le harnais de débogage Playwright                           | [`debugging.md`](debugging.md)           |
| les modules du duel-server, le découpage du protocole WS, les trackers de chaîne, le solveur, les sessions, le code 4426 | [`server.md`](server.md) |

Ailleurs : le design system est [`front/DESIGN-SYSTEM.md`](../../front/DESIGN-SYSTEM.md) ; la pile isolée et la
règle « Karma avant commit » sont dans [`docs/development-guide.md`](../development-guide.md) ; le détail des lots du
pipeline v2 est dans [`docs/anim-pipeline-v2/README.md`](../anim-pipeline-v2/README.md).
