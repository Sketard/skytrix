# Sprint 0 · Prérequis cross-specs duel refresh

**Date :** 2026-05-17
**For :** dev agent (à exécuter AVANT le Sprint 1 de N'IMPORTE LAQUELLE des 3 specs)
**Status :** ready to execute
**Specs concernées :**
- `duel-board-enrichment-spec-2026-05-17.md` (plateau)
- `duel-prompts-refresh-spec-2026-05-17.md` (13 variantes prompts)
- `duel-end-flow-spec-2026-05-17.md` (surrender + result overlay)

---

## 1. Contexte

Les 3 specs partagent des dépendances communes (tokens DS, keyframes
animation, coquille du dev hub). Ce Sprint 0 les installe **une seule
fois** pour éviter la triple-exécution et garantir la cohérence.

**Durée estimée :** 1 jour (1 dev).

**Branche :** `design-system` (continuité de la Wave 3).

---

## 2. Tokens DS à ajouter dans `_tokens.scss`

**Path :** `front/src/app/styles/_tokens.scss`

### 2.1 Overlay global (consommé par prompts + end-flow)

```scss
// Section :root / overlays
--overlay-strong: rgba(15, 23, 42, 0.92);
```

> Ce token n'existait pas. Une fois créé, repointer `--pvp-prompt-dialog-bg`
> ligne 349 pour aligner :
> ```scss
> --pvp-prompt-dialog-bg: var(--overlay-strong);
> ```

### 2.2 Result overlay tints (consommé par end-flow)

```scss
// Section PVP — alignement audit Wave 3
--pvp-result-victory-tint:    rgba(76, 175, 80, 0.18);
--pvp-result-defeat-tint:     rgba(244, 67, 54, 0.18);
--pvp-result-draw-tint:       rgba(255, 193, 7, 0.18);
--pvp-result-disconnect-tint: rgba(8, 18, 38, 0.82);
--pvp-result-timeout-tint:    rgba(30, 18, 4, 0.82);
```

### 2.3 Vintage navy + success-light + success-soft (end-flow)

```scss
// Section PVP / palette extras
--pvp-bg-dark-navy:   #1a1a2e;
--success-light:      #66bb6a;
--success-soft-40:    rgba(76, 175, 80, 0.4);
--success-soft-70:    rgba(76, 175, 80, 0.7);
```

### 2.4 Cyan soft pour brouillage timer opp (board)

```scss
// Section :root / cyan family — pour timer opp brouillé 2C
--pvp-lp-opponent-soft-35: rgba(144, 202, 249, 0.35);
--cyan-500-soft-25:        rgba(74, 144, 217, 0.25);
```

### 2.5 Easing bounce (end-flow result-title-slam)

```scss
// Section transitions
--ease-bounce: cubic-bezier(0.2, 1.4, 0.4, 1);
```

### 2.6 Gradients composites

```scss
// Section gradients — usages cross-composants
--pvp-rematch-invited-gradient: linear-gradient(
  135deg, var(--success), var(--success-light)
);
--pvp-surrender-frame-gradient: linear-gradient(
  180deg, var(--overlay-strong), var(--pvp-bg-dark-navy)
);
```

---

## 3. Keyframes à ajouter dans `_motion.scss`

**Path :** `front/src/app/styles/_motion.scss`

Convention Wave 1 : préfixe `ds-*`, source unique pour les animations
réutilisables. Les keyframes locales (`@keyframes result-title-slam`
etc.) actuellement dans `duel-page-overlays.scss:215-228` doivent être
**déplacées** ici lors du refresh end-flow.

```scss
// === Result overlay (consolidation Wave 3) ===
@keyframes ds-result-overlay-enter {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes ds-result-title-slam {
  from { opacity: 0; transform: scale(2); }
  to   { opacity: 1; transform: scale(1); }
}

@keyframes ds-result-reason-rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes ds-result-btn-fade {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes ds-rematch-invited-pulse {
  0%, 100% { box-shadow: 0 0 8px  var(--success-soft-40); }
  50%      { box-shadow: 0 0 16px var(--success-soft-70); }
}

// === Duel theme ambient animations (board) ===
@keyframes ds-duel-theme-classic-shimmer {
  // valeurs : copier depuis _mockups/mockup-duel-themes.html
  // (sélecteur @keyframes classic-shimmer)
}
@keyframes ds-duel-theme-cosmic-nebula {
  // valeurs : copier depuis @keyframes cosmic-nebula
}
@keyframes ds-duel-theme-cosmic-twinkle {
  // valeurs : copier depuis @keyframes cosmic-stars-twinkle
}
@keyframes ds-duel-theme-forest-breeze {
  // valeurs : copier depuis @keyframes forest-breeze
}
```

---

## 4. Tokens à créer dans `_duel-tokens.scss` (nouveau fichier)

**Path :** `front/src/app/styles/_duel-tokens.scss` (à créer)

Import à ajouter dans `styles.scss` après `@use 'tokens';` :

```scss
@use 'duel-tokens';
```

Contenu initial — squelette pour le Sprint 1 Board (les valeurs réelles
viennent du `mockup-duel-themes.html`, 3 blocs `data-theme`) :

```scss
// ============================================================
// Duel theme tokens — scopés à .board-host[data-theme="X"]
// Ces tokens ne polluent pas le DS global. Convention :
// `--duel-*` = plateau de duel
// `--pvp-*`  = reste du module PvP (prompts, dialogs, hand)
// ============================================================

.board-host[data-theme="classic"] {
  --duel-bg-base:         /* TODO */;
  --duel-bg-radial:       /* TODO */;
  --duel-bg-overlay:      /* TODO */;
  --duel-vignette:        /* TODO */;
  --duel-mat-pattern:     /* TODO */;
  --duel-mat-pattern-opacity: /* TODO */;
  --duel-mat-blend:       /* TODO */;
  --duel-accent-primary:  var(--gold);
  --duel-accent-soft:     var(--gold-soft-30);
  --duel-zone-border:     /* TODO */;
  --duel-zone-bg:         /* TODO */;
  --duel-zone-hover-glow: /* TODO */;
  --duel-emz-bg:          /* TODO */;
  --duel-emz-border:      /* TODO */;
  --duel-emz-glow:        /* TODO */;
  --duel-pile-tint:       /* TODO */;
}

.board-host[data-theme="cosmic"]  { /* idem, valeurs cosmic */ }
.board-host[data-theme="forest"]  { /* idem, valeurs forest */ }
```

---

## 5. Coquille `DuelDevHubComponent` + `DuelDevStateService`

**Owner :** `duel-board-enrichment-spec-2026-05-17.md` §8 — définition
complète du service avec ses 9 signals + `reset()` + helper `override()`
+ factory `_signal()` prod-safe.

**Sprint 0 livre :**

1. **`DuelDevStateService`** — fichier complet selon spec board §8.3.

   **Path :** `front/src/app/pages/pvp/duel-page/duel-dev-hub/duel-dev-state.service.ts`

2. **`DuelDevHubComponent`** — coquille minimale :
   - 3 onglets vides : `Board`, `Prompts`, `End-flow`
   - Listener clavier `Ctrl+Shift+D` (show/hide)
   - Header rouge/orange `🔧 DEV HUB · remove before prod`
   - Floating `top-right`, collapsable
   - **Aucun** contrôle réel (chaque onglet sera implémenté avec sa spec)

   **Path :** `front/src/app/pages/pvp/duel-page/duel-dev-hub/duel-dev-hub.component.{ts,html,scss}`

3. **Import dans `pvp-board-container.component.html`** :
   ```html
   @if (devMode) { <app-duel-dev-hub /> }
   ```
   où `devMode = isDevMode()`.

---

## 6. Checklist d'exécution Sprint 0

- [ ] Ajouter `--overlay-strong` dans `_tokens.scss`
- [ ] Repointer `--pvp-prompt-dialog-bg: var(--overlay-strong)`
- [ ] Ajouter les 5 `--pvp-result-*-tint`
- [ ] Ajouter `--pvp-bg-dark-navy`, `--success-light`, `--success-soft-40/70`
- [ ] Ajouter `--pvp-lp-opponent-soft-35`, `--cyan-500-soft-25`
- [ ] Ajouter `--ease-bounce`
- [ ] Ajouter les 2 gradients composites (`--pvp-rematch-invited-gradient`,
  `--pvp-surrender-frame-gradient`)
- [ ] Ajouter les 5 keyframes `ds-result-*` dans `_motion.scss`
- [ ] Ajouter les 4 keyframes `ds-duel-theme-*` (valeurs copiées du mockup)
- [ ] Créer `_duel-tokens.scss` (squelette TODO, valeurs au Sprint 2 Board)
- [ ] Importer `@use 'duel-tokens';` dans `styles.scss`
- [ ] Créer `DuelDevStateService` (les 9 signals + helper + factory)
- [ ] Créer `DuelDevHubComponent` (coquille tabs vides + raccourci clavier)
- [ ] Importer `<app-duel-dev-hub>` dans `pvp-board-container.component.html`
  sous gate `@if (devMode)`
- [ ] Test compile : `ng build` ne casse pas, tokens résolvent
- [ ] Test runtime : `Ctrl+Shift+D` toggle le hub, les 3 onglets sont
  visibles et vides
- [ ] Vérif bundle prod : `ng build --configuration production` →
  les setters de signals dev doivent être no-op (vérifier via DevTools
  qu'aucun forced n'a d'effet en prod)

---

## 7. Critères de complétion

Sprint 0 est terminé quand :
- ✅ Tous les tokens cités dans les 3 specs résolvent (`var(--X)` sans
  fallback hardcoded nécessaire)
- ✅ Les keyframes `ds-result-*` et `ds-duel-theme-*` existent dans
  `_motion.scss`
- ✅ `DuelDevHubComponent` apparaît avec `Ctrl+Shift+D` sur le board
  (en dev mode) et disparaît en prod
- ✅ Aucun warning compile, aucun test cassé
- ✅ La branche est mergeable sans toucher au comportement runtime du
  duel (les tokens créés ne sont pas encore consommés — Sprint 1
  démarre le refresh)

À la complétion, les 3 Sprint 1 (Board / Prompts / End-flow) peuvent
démarrer indépendamment, en parallèle ou en série selon disponibilité
dev.

---

## 8. Refs

- Spec board : `duel-board-enrichment-spec-2026-05-17.md` (§8 owner du
  hub)
- Spec prompts : `duel-prompts-refresh-spec-2026-05-17.md` (§5 tokens
  audit, §9 onglet prompts)
- Spec end-flow : `duel-end-flow-spec-2026-05-17.md` (§3.3 tokens, §3.4
  keyframes, §8 onglet end-flow)
- Audit Wave 3 : `ds-wave-3-duel-audit-2026-05-15.md` (§70-78 tokens à
  créer, §20-24 keyframes à consolider)
- DS strategy : [project_design_system_strategy](../../C:\Users\Axel\.claude\projects\c--Users-Axel-Desktop-code-skytrix\memory\project_design_system_strategy.md)
- DS doctrine : [project_ds_token_doctrine](../../C:\Users\Axel\.claude\projects\c--Users-Axel-Desktop-code-skytrix\memory\project_ds_token_doctrine.md)
