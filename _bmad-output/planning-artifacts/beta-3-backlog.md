# β.3 Backlog — Post-livraison

**Date** : 2026-05-26.
**Branche** : `feat/anim-pipeline-v2`.

Inventaire des findings issus du red-team adversarial sur β.3 ET des
limitations rencontrées en livraison. Chacun a un statut : ✅ fixé,
🟡 backlog (avec justification), 🔴 acté pour β.x prochain.

---

## Finding #5 — `_eventStream.set([])` ordering vs DEP `EffectAbandoned`

**Statut** : 🟡 backlog acté.

**Symptôme** :
`resetAllState(scopes)` appelle dans cet ordre :
1. `this.scopeDispatcher?.dispatch(scopes)` — la dispatcher itère sur
   les targets registered. Le DEP est le premier. Son `applyReset`
   émet `EffectAbandoned(reason='checkpoint')` pour chaque deferred
   actif via `pushDeferredToStream` → `_eventStream.set([...prev,
   abandoned])`.
2. `_eventStream.set([])` — wipe complet.

Conséquence : les `EffectAbandoned` poussés par le DEP atterrissent
sur le stream PUIS sont effacés AVANT que l'effect Angular drainant le
stream (côté projection) n'ait eu son micro-task de tick. Les
projections qui consomment `EffectAbandoned` (`OverlayShowReadyProjection`
en est la première à β.3) reçoivent leur propre `applyReset` directement
après celui du DEP (toujours dans la même `dispatch`), donc l'état est
clean. **Le bug est bénin par accident** : les `EffectAbandoned` sont
"perdus" mais les projections étaient déjà reset.

**Pourquoi backlog plutôt que fix immédiat** :

Le fix "propre" (`_eventStream.set([])` AVANT `dispatch`) est trompeur :
les `EffectAbandoned` émis par le DEP atterriraient dans le stream juste
wipé, mais l'effect Angular des projections ne tickerait qu'après la
fin de `resetAllState`. Au tick suivant, les projections verraient
l'EffectAbandoned ET leur valeur post-`applyReset` (set vide pour
`OverlayShowReadyProjection`) — l'EffectAbandoned RE-ajouterait la
chainId au set, contradisant le reset.

Le fix qui marche vraiment implique :
- (a) Soit drainer synchronement l'effect des projections après le
  dispatch (Angular ne l'expose pas — `flushEffects` est privé).
- (b) Soit splitter le `dispatch` en 2 passes — DEP d'abord (qui
  émet), puis flush manuel du stream effect, puis projections — ce
  qui demande un changement d'API significatif.
- (c) Soit le DEP n'émet PAS d'`EffectAbandoned` lors d'un §3.6
  checkpoint (équivalent au `silentReset`) — option simple mais elle
  enlève au journal la visibilité sur le "pourquoi" du reset.

Option (c) est la plus tenable mais retire de la valeur observabilité.
Option (b) est correcte mais lourde. Option (a) est interdite par
l'API publique d'Angular.

**Décision β.3** : conserver le comportement actuel (documenté inline
dans `resetAllState`). Tant qu'aucune projection consommatrice
d'`EffectAbandoned` ne dépend du séquencing en cas de checkpoint, le
bug est invisible. **Revisiter en β.x** quand une projection
légitimement consommatrice de `EffectAbandoned` (pas juste comme
fallback) sera ajoutée.

**Triggers de re-priorisation** :
- Une projection qui DOIT voir `EffectAbandoned(checkpoint)` pour ne
  pas se désynchroniser après un STATE_SYNC.
- Une règle DEP dont le `name` collide silencieusement avec une autre
  à cause d'un abandon manqué.

**Re-audit 2026-05-28** : passe de chasse-aux-sorcières δ. Aucune
projection consommatrice d'`EffectAbandoned` autrement qu'en fallback
graceful-degradation. Aucune règle DEP ne collide structurellement (les
6 règles livrées indexent par chainIndex / ref / cardCode uniques). La
décision β.3 (conserver le comportement actuel) reste valide. Honoré.

---

## Findings ✅ fixés

### Finding #2 — Buffered LP path n'émet pas `AnimationCompleted`
Fix : `processDirective.case 'lp'` émet désormais `AnimationStarted` +
`AnimationCompleted` (le second après un `setTimeout(durationMs)`
matchant la durée LP). Commit dans Work Item 3.

### Finding #10 — `_overlayShowEffectRef` single ref écrasé par link N+1
Fix : remplacé par `Map<chainIndex, EffectRef>`. Chaque chainIndex
détient son propre effect ; cleanup explicite en `onChainEnd` (sweep
de la map) + `destroyRef`. Commit dans Work Item 3.

---

## Finding #11 — pile-target-float-cleanup migration DEP

**Statut** : 🟡 backlog honoré (audit δ 2026-05-28).

**Symptôme attendu** : aucun. Le pattern actuel (`targetIndicator.cleanup()`
sync dans `handleChainSolving` + `scheduleCleanup(holdMs)` safety net sur
le dernier MSG_BECOME_TARGET + `TARGET_PILE_FLOAT_FADE_OUT_MS` fade
durée) couvre les cas connus. La spec β.2c demandait une migration vers
règle DEP via émission d'un event `TargetFloatCreated/Destroyed` sur le
flux + règle pile-float-cleanup.

**Audit δ 2026-05-28** : aucun bug observé. La migration apporterait
de l'élégance architecturale (élimination d'un cleanup path ad-hoc) sans
fixer de symptôme. Coût ~150-200 LOC + nouveau type d'event + tests
T-V. Décision : honorer la décision β.2 de reporter à β.2c — non-livré
en δ.

**Triggers de re-priorisation** :
- Bug observé de float reticle qui reste collé après chain résolution.
- Race observée entre `scheduleCleanup(holdMs)` et `cleanup()` sync
  (double cleanup malgré l'idempotence).
- Nouveau use-case nécessitant le float manager comme source d'event
  sur le flux (e.g., projection qui veut observer "y a-t-il un float
  pile actif ?").

---

## Drops β.3 (non-fixes, documentés pour traçabilité)

Voir CLAUDE.md section "Projections β.3 (Lots 1-4)" et la doctrine
"projection vs signal manager". Quatre signaux NON migrés :
- `chainOverlayBoardChanged` (supprimé : remplacé par
  `chainManager.hasBufferedEvents` getter).
- `confirmRevealedCards` (orphelin big-bang : supprimé).
- `chainResolutionAnnounce` (livré en Lot 3.2-REDO via la projection
  + sync mirror `_announcePending`).
- `targetedZoneKeys` (livré en Lot 4.1-REDO).

Les deux derniers sont migrés ; ce fichier en garde mémoire.
