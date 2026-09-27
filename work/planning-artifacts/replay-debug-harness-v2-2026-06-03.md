# Replay debug harness v2 — backlog spec (2026-06-03)

> **Statut** : backlog, à faire dans une session dédiée. Pas urgent. Pas de
> dépendance bloquante sur les tests Karma de couche 1.

## Motivation

Le harness actuel (`front/e2e/debug-replay-harness.ts`, v1.0.0) est conçu pour
le scenario "lance, joue à fond, capture les logs". Il a 3 limitations qui
nous ont gêné lors de la session du 2026-06-03 :

1. **Pas d'API pour seek arrière post-play** — l'option `fromEvent` fait un
   seek cold-start via `?seekTo=N`, mais on ne peut pas pause-then-rewind
   après que le replay ait joué. On a contourné en codant un spec ad-hoc
   (`debug-overlay-seek.spec.ts`, supprimé) qui cliquait sur les boutons
   transport via `page.locator` — fonctionnel mais fragile (labels i18n,
   sélecteurs CSS).

2. **Pas d'API pour stepper événement par événement** — utile pour aller à
   un point précis (ex. juste avant l'arrivée de MSG_CHAINING d'un link) et
   capturer l'état exact. Aujourd'hui on doit `waitForTimeout(N)` aveuglément
   en espérant que N événements aient été process.

3. **Pas d'API pour observer le state via signaux** — le harness expose
   `__skytrixDebug.snapshot()` qui dump tout d'un coup, mais on n'a pas
   d'helper pour attendre qu'un signal atteigne une valeur précise
   (genre "attends que `currentIndex === 14`" ou "attends que
   `phase === 'resolving'`").

## Surface API souhaitée

```ts
// Nouveau type d'entrée du harness — un controller qu'on instancie une fois
// puis appelle des méthodes dessus.
const ctrl = await openReplayDebug(ctx, {
  replayId: 'a1eed2d6-...',
  perspective: 0,
  buildFirst: false,
  outDir: '...',  // optionnel, défaut tagué par date
});

// Contrôle de transport — chaque méthode wait que l'action soit terminée
// (board state stable, busy=false, animations settled).
await ctrl.play();
await ctrl.pause();
await ctrl.seekToEvent(14);          // index dans la timeline
await ctrl.seekToTurn(3);             // index de tour
await ctrl.seekToStart();
await ctrl.seekToEnd();
await ctrl.stepForward();             // 1 event
await ctrl.stepBack();

// Attente conditionnelle — bloquant jusqu'à ce que le signal atteigne la
// valeur attendue, ou timeout.
await ctrl.waitUntil(() => snapshot.chainPhase === 'resolving', { timeoutMs: 10_000 });
await ctrl.waitForLog(/EffectReady overlay-show:chain-1/, { timeoutMs: 5_000 });
await ctrl.waitForBoardStable({ timeoutMs: 2_000 });  // busy=false + queue empty

// Inspection — snapshot ponctuel.
const snap = await ctrl.snapshot();   // équivalent __skytrixDebug.snapshot()
const idx = await ctrl.currentIndex();
const isPlaying = await ctrl.isPlaying();

// Capture — screenshot + log à un instant T (par exemple juste après seek).
await ctrl.captureFrame('after-seek');

// Logs — toujours accumulés en arrière-plan, accessibles à tout moment.
const logs = ctrl.logs;               // array d'entrées { t, type, text }
const filtered = ctrl.logsContaining('[ANIM:DEP]');

// Teardown — flush du report + fermeture page.
await ctrl.finalize();                // écrit report.md + console.log + close
```

## Pattern attendu côté spec

```ts
test('overlay timing — seek-back regression', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const ctrl = await openReplayDebug(ctx, { replayId: '...', perspective: 0 });

  try {
    // Phase 1 — first play through the chain
    await ctrl.play();
    await ctrl.waitForLog(/MSG_CHAIN_END/, { timeoutMs: 30_000 });
    await ctrl.pause();
    const firstPlayLogs = ctrl.logsContaining('Projection.add chainId');
    expect(firstPlayLogs.length).toBe(3);  // chain links 1, 2, 3

    // Phase 2 — seek back
    await ctrl.seekToStart();
    expect(await ctrl.currentIndex()).toBe(0);

    // Phase 3 — second play, no residual state
    await ctrl.play();
    await ctrl.waitForLog(/MSG_CHAIN_END/, { timeoutMs: 30_000 });
    const secondPlayGateLogs = ctrl.logsContaining('_gateOverlayShowOnReady readyNow=true');
    expect(secondPlayGateLogs).toEqual([]);  // jamais readyNow=true à la 2e lecture
  } finally {
    await ctrl.finalize();
    await ctx.close();
  }
});
```

## Choix d'implémentation à trancher en session dédiée

### Q1 — Communication browser↔Node : `page.evaluate` ou `page.exposeFunction` ?

Pour `seekToEvent` etc., deux options :
- **A** : Click le bouton UI via `page.locator` (fragile : labels i18n, sélecteurs CSS qui changent).
- **B** : Expose une API debug côté browser via `__skytrixDebug` (genre `__skytrixDebug.transport.seek(14)`) et appel via `page.evaluate(() => window.__skytrixDebug.transport.seek(14))`.

Recommandation : **B**. Ajouter une surface debug sur `DuelDebugService` qui expose `transport` ref. Découplé des labels UI, deterministe.

### Q2 — `waitForLog` regex ou substring ?

Substring est suffisant pour 90% des cas et plus rapide à grep. Regex pour les cas pointus.

Probablement faire les deux : `waitForLog(string | RegExp, opts)`.

### Q3 — `waitForBoardStable` — comment définir "stable" ?

Quatre signaux conjuguent :
- `adapter.busy()` false
- `adapter.animationQueue().length === 0`
- `orchestrator.isAnimating()` false
- `chainOverlay.overlayActive()` false (le signal ajouté 2026-06-03)

Probablement le 4e (overlayActive) est superflu — il dépend des 3 autres dans le pipeline normal. Mais pour les transitions de seek, il pourrait être pertinent. À tester en pratique.

### Q4 — Polling vs event-driven pour `waitUntil` ?

Options :
- Poll toutes les 50ms le state via `page.evaluate(() => snapshot)`. Simple, déterministe, surcoût ~5%.
- Stream le state via `page.exposeFunction('__notifyDebug', callback)` et `effect()` côté browser qui call quand un signal change. Plus efficace mais plus complexe.

Probablement **poll** pour la v1 — yagni.

### Q5 — Helpers spécifiques au domaine pvp ?

Genre `await ctrl.waitForChainLink(2)` qui poll `activeChainLinks().length`. À voir si ça vaut le coup ou si `waitForLog` suffit.

## Coût estimé

- Surface API + helpers généraux : ~2h
- Surface debug `__skytrixDebug.transport` côté browser : ~30min
- Migration de la spec actuelle `debug-replay-example.spec.ts` vers le nouveau pattern : ~30min
- Doc + exemples : ~30min

Total : ~3-4h. Pas urgent, à planifier indépendamment.

## Pré-requis avant de coder

- Lire le harness actuel `front/e2e/debug-replay-harness.ts` v1 — savoir ce qu'on garde, ce qu'on remplace.
- Vérifier que `DuelDebugService` est bien provider-scope `replay-page.component.ts` (déjà fait).
- Confirmer le code des transport buttons côté `transport-bar` — comment leur cliquer programmatiquement de façon déterministe (et pourquoi on préfère via debug API plutôt qu'UI).

## Notes méta

Ce backlog a été extrait d'une session de debug pendant laquelle on a hard-codé
les seek arrière + replay via des clicks UI fragiles. Le bug 5 (`ScopeResetDispatcher`
manquant) n'aurait pas été trivial à diagnostiquer sans pouvoir piloter seek+replay
+ collecter logs. Cette session a démontré la valeur du harness — donc
investir dans v2 a un ROI direct sur les futurs bugs animation pipeline.

Le harness v1 reste compatible (l'API `runReplayDebug` ne change pas). v2 ajoute
une surface plus expressive sans casser l'existant.
