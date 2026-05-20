# Duel End-Flow Refresh · Implementation Spec

**Date :** 2026-05-17
**Author :** Sally (UX Designer) + Claude review
**For :** dev agent (Amelia / `bmad-quick-dev`)
**Status :** ready to port
**Mockups de référence :**
- `_mockups/mockup-duel-in-game.html` — vues **Composants** (Surrender) +
  **Results** (Result Overlay 3 variantes + rematch invited)

---

## 1. Contexte

Cette spec couvre la **fin de duel** : 2 composants distincts mais
logiquement liés (un mène à l'autre dans le flow utilisateur).

1. **Surrender Dialog** — refonte du `mat-dialog` actuel en panel custom
   DS-conforme (gold frame, anti-mistap).
2. **Result Overlay** — refresh DS + retrait du bouton "Back to deck"
   (décision UX mockup validée) + variantes outcome (victory/defeat/draw)
   + variante rematch invited.

**Code existant :**
- Surrender = `<ng-template #surrenderDialog>` dans
  `duel-page.component.html:541` + `confirmSurrender()` dans
  `duel-page.component.ts:847` (utilise `MatDialog` avec
  `mat-flat-button` + `mat-stroked-button`).
- Result overlay = inline dans `duel-page.component.html:457` + SCSS
  dans `duel-page-overlays.scss:110` (~100 lignes, fortement hardcodées).

**Hors scope :**
- Logique de surrender (envoi WS, gestion résultat) — intacte.
- Logique de rematch state machine (idle/requested/invited/...) —
  intacte.
- Logique de duelResult (mapping reason → outcome) — intacte.
- Prompts in-duel → spec séparée
  `duel-prompts-refresh-spec-2026-05-17.md`.
- Phase pill + Timer → spec
  `duel-board-enrichment-spec-2026-05-17.md`.

---

## 2. Surrender Dialog

### 2.1 Refonte structurelle

**Actuel** : `mat-dialog-title` + `mat-dialog-content` + `mat-dialog-actions`
avec `mat-flat-button` (Surrender) et `mat-stroked-button` (Cancel).

**Cible mockup** : panel custom `.surrender-dialog` avec :
- Frame gold-soft (border + gradient interne)
- **Cancel = bouton primary gold** (focus par défaut, anti-mistap —
  l'utilisateur appuie sur Enter par accident → annule, pas surrender)
- **Surrender = bouton rouge discret** (border + texte rouge, pas un
  fond plein agressif)

### 2.2 Décision technique : conserver `MatDialog` ou pas ?

**Conserver `MatDialog`** comme container (gestion focus-trap, backdrop,
escape key, a11y dialog role). **Remplacer uniquement le template** par
une structure DS-conforme.

Avantages :
- Pas de re-implémentation de la mécanique modal/a11y (Material gère
  bien)
- Surface de risque minimale (logique `confirmSurrender()` intacte)
- Le custom panelClass déjà en place (`pvp-dialog-panel--danger`)
  permet de styler librement le container Material

Inconvénients :
- Le `mat-dialog-container` impose un padding + bg par défaut → override
  via `::ng-deep .pvp-dialog-panel--danger .mat-mdc-dialog-container`
  (déjà la convention dans `duel-page-overlays.scss` ou équivalent à
  créer)

### 2.3 Structure HTML cible

**Décision DS** : utiliser le **partial DS `.btn`** déjà en place
(`_buttons.scss`) au lieu de classes custom `.surrender-btn--*`.
Le partial offre exactement ce qu'on veut :
- `.btn .btn--danger` = "rouge discret" (border + texte rouge, fond
  transparent) — *exactement* le visuel mockup pour Surrender
- `.btn .btn--primary` = gradient gold doré — anti-mistap pour Cancel

Bénéfice : cohérence visuelle automatique avec lobby, replay hub, et
toutes les autres surfaces DS-conformes du projet. Aucun nouveau style
custom à introduire.

Dans `duel-page.component.html` ligne 541 — remplacer le
`<ng-template #surrenderDialog>` par :

```html
<ng-template #surrenderDialog>
  <div class="surrender-dialog" role="alertdialog"
       aria-labelledby="surrender-title"
       aria-describedby="surrender-desc">
    <h2 id="surrender-title" class="surrender-dialog__title">
      {{ 'duel.surrender.title' | translate }}
    </h2>
    <p id="surrender-desc" class="surrender-dialog__desc">
      {{ 'duel.surrender.warning' | translate }}
    </p>
    <div class="surrender-dialog__actions">
      <button class="btn btn--danger btn--md"
              type="button"
              [mat-dialog-close]="true">
        {{ 'duel.surrender.confirm' | translate }}
      </button>
      <button class="btn btn--primary btn--md"
              type="button"
              autofocus
              [mat-dialog-close]="false">
        {{ 'common.cancel' | translate }}
      </button>
    </div>
  </div>
</ng-template>
```

**Notes :**
- Ordre des boutons : **Surrender en premier** dans le DOM (tab order),
  **Cancel en deuxième avec `autofocus`** — focus initial sur Cancel
  (anti-mistap). Visuellement Cancel apparaît à droite (côté action
  positive) via `flex-direction: row` ou ordre CSS.
- Suppression des `mat-flat-button` / `mat-stroked-button` — partial
  `.btn` uniquement (pas de couche MDC à combattre, cf
  [project_design_system_strategy](memory) Wave 1.5 — `mat-raised-button`
  conflit MDC vs `.btn--primary`).

### 2.4 SCSS

**Location :** `duel-page-overlays.scss` (existing) ou créer
`_surrender-dialog.scss` partial sous `front/src/app/styles/` si
l'utilisateur préfère isoler.

```scss
// Création d'un token gradient dédié au "surrender frame"
// dans _duel-tokens.scss ou _tokens.scss :
//   --pvp-surrender-frame-gradient: linear-gradient(
//     180deg, var(--overlay-strong), var(--pvp-bg-dark-navy)
//   );
// (`--pvp-bg-dark-navy` est ajouté par l'audit Wave 3 — value: #1a1a2e ≈
// rgba(15, 12, 6, 0.95) sémantique "vintage dark navy")

.surrender-dialog {
  padding: var(--space-5);
  background: var(--pvp-surrender-frame-gradient);
  border: 1px solid var(--gold-soft-30);
  border-radius: var(--radius-md);
  min-width: 320px;
  max-width: 400px;

  &__title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    color: var(--gold);
    margin: 0 0 var(--space-3);
    text-align: center;
    letter-spacing: 0.05em;
  }

  &__desc {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin: 0 0 var(--space-5);
    line-height: 1.5;
    text-align: center;
  }

  &__actions {
    display: flex;
    gap: var(--space-3);
    justify-content: flex-end;
  }
}

// Pas de classes .surrender-btn — le partial _buttons.scss (.btn,
// .btn--primary, .btn--danger, .btn--md) couvre tout. focus-visible,
// hover, sizing et touch-target sont déjà fournis par le DS.
```

**Override Material container** (à ajouter, soit ici soit dans
`styles.scss` selon convention) :

```scss
::ng-deep .pvp-dialog-panel--danger .mat-mdc-dialog-container {
  --mdc-dialog-container-color: transparent;
  padding: 0;
  box-shadow: var(--elevation-3);
}
```

### 2.5 i18n

Clés existantes (intactes) :
- `duel.surrender.title`
- `duel.surrender.warning`
- `duel.surrender.confirm`
- `common.cancel`

Pas de nouvelle clé. Si le message warning est trop court vs le mockup
("Are you sure you want to surrender? Your opponent will be awarded the
win."), vérifier la traduction FR existante — sinon enrichir.

---

## 3. Result Overlay

### 3.1 Décisions UX validées dans le mockup

1. **Retirer le bouton "Back to deck"** (`result-overlay__deck-link`) —
   confirmé par le tag `.result-overlay · sans Back to deck` dans le
   mockup. Le retour au deck builder se fait via le bouton "Leave duel"
   qui ramène au lobby, puis navigation classique.
2. **Garder 2 boutons** : `Rematch` (gold gradient, primary) et
   `Leave duel` (secondary).
3. **Outcome variants** : Victory / Defeat / Draw avec radial tint
   coloré (vert / rouge / ambré).
4. **Rematch invited** : pulse vert success sur le bouton Rematch
   (l'adversaire a déjà proposé un rematch, accepter en 1 clic).

### 3.2 Refonte HTML

Dans `duel-page.component.html` ligne 457 — modifier :

```html
@if (resultOutcome(); as result) {
  <div class="result-overlay"
       [class.result-overlay--victory]="result.outcome === 'victory'"
       [class.result-overlay--defeat]="result.outcome === 'defeat'"
       [class.result-overlay--draw]="result.outcome === 'draw'"
       [class.result-overlay--cause-disconnect]="result.cause === 'disconnect' || result.cause === 'draw_both_disconnect'"
       [class.result-overlay--cause-timeout]="result.cause === 'timeout' || result.cause === 'inactivity'"
       role="status" aria-live="assertive">
    <h1 class="result-overlay__title">
      @switch (result.outcome) {
        @case ('victory') { {{ 'duel.result.victory' | translate }} }
        @case ('defeat')  { {{ 'duel.result.defeat'  | translate }} }
        @case ('draw')    { {{ 'duel.result.draw'    | translate }} }
      }
    </h1>
    <p class="result-overlay__reason">{{ result.reason }}</p>

    <div class="result-overlay__actions">
      <button class="btn btn--ghost btn--lg"
              type="button"
              autofocus
              (click)="backToLobby()">
        {{ 'duel.leaveRoom' | translate }}
      </button>
      <button class="btn btn--primary btn--lg"
              type="button"
              [class.is-invited]="wsService.rematchState() === 'invited'"
              [disabled]="rematchDisabled()"
              (click)="onRematchClick()">
        {{ rematchButtonLabel() }}
      </button>
    </div>
  </div>
}
```

**Diffs vs actuel :**
- Suppression `__content` wrapper (rendu inutile, styles directs sur
  `.result-overlay`)
- Suppression `<button class="result-overlay__deck-link">` (Back to deck)
- **Ordre des boutons** : Leave à gauche, Rematch à droite (mockup) —
  inversé vs actuel. `autofocus` sur **Leave** (anti-mistap : Enter
  sort plutôt que de rematch, cohérent avec surrender).
- **Décision DS** : utiliser le partial `.btn`. `.btn--ghost` pour Leave
  (border discrète, fond transparent), `.btn--primary` pour Rematch
  (gradient gold). Le pattern "invited" devient une modifier-class
  `.is-invited` qui surcharge uniquement le background + animation
  (cf SCSS ci-dessous), sans dupliquer le sizing/typo du partial DS.
- Suppression `mat-stroked-button` sur le bouton Leave — partial DS
  uniquement.

### 3.3 Tokens à créer (alignement audit Wave 3)

L'audit Wave 3 (`ds-wave-3-duel-audit-2026-05-15.md` §76-78) acte les
4 tokens result-tints. Cette spec les **consomme** au lieu de hardcoder.
Sprint 0 prérequis = créer ces tokens dans `_tokens.scss` :

```scss
// _tokens.scss — section PVP
--pvp-result-victory-tint:    rgba(76, 175, 80, 0.18);  // vert success doux
--pvp-result-defeat-tint:     rgba(244, 67, 54, 0.18);  // rouge danger doux
--pvp-result-draw-tint:       rgba(255, 193, 7, 0.18);  // ambré warning doux
--pvp-result-disconnect-tint: rgba(8, 18, 38, 0.82);    // bleu-gris neutre
--pvp-result-timeout-tint:    rgba(30, 18, 4, 0.82);    // ambré sombre

// Gradient invited pulse (vert success → vert clair)
--pvp-rematch-invited-gradient: linear-gradient(
  135deg, var(--success), var(--success-light)
);
// (`--success-light` à ajouter aussi, valeur `#66bb6a`)

// Gradient surrender frame
--pvp-surrender-frame-gradient: linear-gradient(
  180deg, var(--overlay-strong), var(--pvp-bg-dark-navy)
);
// (`--pvp-bg-dark-navy` audit Wave 3 §71, valeur `#1a1a2e`)
```

### 3.4 Keyframes — consolidation `_motion.scss` (convention `ds-*`)

L'audit Wave 3 (§20-24) demande la consolidation des 4 keyframes
result-overlay vers `_motion.scss` avec préfixe `ds-*`. Cette spec
**applique** cette consolidation :

```scss
// front/src/app/styles/_motion.scss — ajouter ces 5 keyframes
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
  0%, 100% { box-shadow: 0 0 8px var(--success-soft-40); }
  50%      { box-shadow: 0 0 16px var(--success-soft-70); }
}
```

`--success-soft-40` et `--success-soft-70` (valeurs
`rgba(76,175,80,0.4)` et `rgba(76,175,80,0.7)`) à ajouter dans
`_tokens.scss` si absents — cf prérequis Sprint 0.

**Durée du title-slam** : `350ms` est hors échelle DS standard
(`--transition-fast=150 / -normal=250 / -slow=400`). Choisir
`--transition-slow` (400ms) pour aligner sur le DS — perte visuelle
imperceptible (50ms), gain doctrinal.

**Easing du title-slam** : `cubic-bezier(0.2, 1.4, 0.4, 1)` est un
overshoot — vérifier si `--ease-spring` existe dans le DS. Sinon créer
le token `--ease-bounce: cubic-bezier(0.2, 1.4, 0.4, 1);` dans
`_tokens.scss`. Geometry locale d'animation = ce n'est PAS de
geometry, c'est de la sémantique motion → token légitime.

### 3.5 SCSS — refresh complet

**Location :** `duel-page-overlays.scss:110` — réécrire la section
`.result-overlay` complète :

```scss
.result-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6);
  background: var(--overlay-strong);
  backdrop-filter: blur(4px);
  z-index: z.$z-pvp-result-overlay;
  animation: ds-result-overlay-enter var(--transition-normal) var(--ease-out) both;

  // Outcome-based radial tint (tokens DS, pas de hardcode)
  &--victory {
    background:
      radial-gradient(ellipse at center, var(--pvp-result-victory-tint) 0%, transparent 60%),
      var(--overlay-strong);
  }
  &--defeat {
    background:
      radial-gradient(ellipse at center, var(--pvp-result-defeat-tint) 0%, transparent 60%),
      var(--overlay-strong);
  }
  &--draw {
    background:
      radial-gradient(ellipse at center, var(--pvp-result-draw-tint) 0%, transparent 60%),
      var(--overlay-strong);
  }

  // Cause overrides — neutralisent le radial tint (info dominante)
  &--cause-disconnect { background: var(--pvp-result-disconnect-tint); }
  &--cause-timeout    { background: var(--pvp-result-timeout-tint); }

  &__title {
    font-family: var(--font-display);
    font-size: clamp(2rem, 8vw, 3.5rem);
    font-weight: var(--weight-black);
    letter-spacing: 0.15em;
    margin: 0;
    text-transform: uppercase;
    animation: ds-result-title-slam var(--transition-slow) var(--ease-bounce) 100ms both;

    .result-overlay--victory & { color: var(--success); }
    .result-overlay--defeat &  { color: var(--danger-strong); }
    .result-overlay--draw &    { color: var(--warning); }

    .result-overlay--cause-disconnect & { color: var(--text-primary); }
  }

  &__reason {
    font-size: var(--text-md);
    color: var(--text-secondary);
    margin: 0;
    text-align: center;
    max-width: 600px;
    animation: ds-result-reason-rise var(--transition-normal) var(--ease-out) 350ms both;
  }

  &__actions {
    display: flex;
    flex-direction: row;
    gap: var(--space-3);
    margin-top: var(--space-4);

    > *:nth-child(1) { animation: ds-result-btn-fade var(--transition-normal) var(--ease-out) 500ms both; }
    > *:nth-child(2) { animation: ds-result-btn-fade var(--transition-normal) var(--ease-out) 580ms both; }
  }
}

// Rematch invited — surcharge légère du partial .btn--primary
.btn.btn--primary.is-invited {
  background: var(--pvp-rematch-invited-gradient);
  border-color: var(--success);
  animation: ds-rematch-invited-pulse 1.5s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .result-overlay {
    animation: none;

    &__title, &__reason, &__actions > * { animation: none; }
  }
  .btn.btn--primary.is-invited { animation: none; }
}
```

**Notes :**
- Plus aucune `@keyframes` locale — toutes consolidées dans
  `_motion.scss` (§3.4 ci-dessus).
- Plus aucun `rgba(...)` ou hex hardcodé — toutes les couleurs
  passent par tokens.
- Plus de `min-width: 180px` ou `min-height: var(--touch-target-min)`
  redéclaré — c'est `.btn--lg` qui les fournit (`min-height: 48px`).
- Plus de `font-family`, `font-size`, `font-weight`, `letter-spacing`
  pour les boutons — fournis par `.btn`.

### 3.6 TS — retirer `backToDeck()`

**Audit vérifié 2026-05-17** : 3 sites d'usage uniquement —
`duel-page.component.ts:651`, `duel-page.component.html:488`,
`assets/i18n/{fr,en}.json:238`. Aucun spec, aucun deep-link, aucun
autre composant.

**Suppression safe.** Action Sprint 2 :
1. Retirer `<button class="result-overlay__deck-link">...` du HTML
2. Retirer méthode `backToDeck()` du TS
3. Retirer clé `duel.result.backToDeck` des 2 fichiers i18n FR + EN
4. `grep -r "backToDeck\|result\.backToDeck"` final pour confirmer 0 résidu

---

## 4. Card Action Menu — note de cadrage

Le mockup view **Composants** contient également une section "Card
Action Menu" (niveau 1 + niveau 2 sub-effects). Cette refonte est
**incluse dans la spec prompts** (`duel-prompts-refresh-spec-2026-05-17.md`
§ 4.11), pas ici, car :
- C'est un popover déclenché par l'interaction avec une carte (pas
  un overlay de fin de duel)
- Il vit dans `duel-page-ui.scss` à côté des autres surfaces
  d'interaction (zones, hands)
- Son refresh DS suit les mêmes règles que les prompts

Si tu lis cette spec et te demandes "et le card menu ?" → cf spec
prompts.

---

## 5. Contraintes architecturales

### 5.1 Animation Parity

Aucune. Surrender + Result overlay ne sont pas touchés par
l'orchestrator (overlays fin de partie, après MSG_WIN ou cleanup).

### 5.2 Replay Parity

**Vérifié 2026-05-17** :
`grep -r "result-overlay\|resultOutcome\|duelResult" front/src/app/pages/pvp/replay/`
→ **0 résultat**. Le replay n'affiche PAS de result overlay
aujourd'hui (l'utilisateur retourne au hub avant la fin de la
timeline).

**Décision tranchée** :
- **Surrender** : N/A — pas de surrender en replay (read-only).
- **Result Overlay** : **N/A confirmé**. Hors scope de cette spec. Si
  une demande future apparaît (afficher le résultat à la fin d'un
  replay), créer une spec dédiée — il faudra exposer un signal
  équivalent depuis `ReplayDuelAdapter` (cf Animation Parity Rule).

Aucun travail côté replay pour le port end-flow.

### 5.3 i18n

- Toutes les clés `duel.result.*`, `duel.surrender.*`, `duel.leaveRoom`,
  `common.cancel` existent déjà.
- **Si retrait** : supprimer `duel.result.backToDeck` après vérif d'usage.
- Pas de nouvelle clé.

### 5.4 DS Token Doctrine

Strict respect de [project_ds_token_doctrine](memory) :
- 100% des couleurs en tokens
- 100% des spacings en `--space-*`
- 100% des transitions en `--transition-*`
- Geometry locale (180px min-width des boutons, 320-400px du
  surrender) tolérée
- Pas de nouveau token `--surrender-*` ou `--result-overlay-*` à créer
  (DS générique suffit)

### 5.5 A11y

- **Surrender** : `role="alertdialog"` (action destructive), `aria-labelledby`,
  `aria-describedby`, focus initial sur Cancel (anti-mistap), trap focus
  (géré par Material), escape ferme (géré par Material `disableClose: false`).
- **Result Overlay** : `role="status"` + `aria-live="assertive"` (déjà
  en place), focus initial sur Leave (anti-mistap), Enter key sur Leave
  ferme le duel.

---

## 6. Checklist de test en vrai

### Surrender
- [ ] Click sur Exit ouvre le dialog
- [ ] Cancel est focusé par défaut (cursor visible sur Cancel, pas
  Surrender)
- [ ] Enter sur dialog ouvert → Cancel (pas surrender)
- [ ] Escape ferme le dialog
- [ ] Surrender envoie le WS et déclenche le Result Overlay
- [ ] Visuel : frame gold-soft, Cancel gold solid, Surrender rouge
  discret (border + texte)
- [ ] Mobile : touch targets ≥ 44px, layout pas cassé
- [ ] focus-visible visible sur tab navigation

### Result Overlay
- [ ] Victory affiche le titre vert avec radial tint vert subtil
- [ ] Defeat affiche rouge
- [ ] Draw affiche ambré
- [ ] Disconnect override le radial tint (bleu-gris neutre)
- [ ] Timeout override le radial tint (ambré sombre)
- [ ] Rematch button gold gradient, hover glow
- [ ] Rematch invited : pulse vert success
- [ ] Leave focusé par défaut (cf décision § 3.2)
- [ ] Click Leave → retour lobby
- [ ] Click Rematch → état requested/invited correct
- [ ] **Pas de bouton "Back to deck"** (retiré, vérifier)
- [ ] Animation slam du titre + fade des boutons
- [ ] `prefers-reduced-motion: reduce` désactive toutes les animations
  (titre, reason, buttons, invited pulse)
- [ ] Narrow viewport : title clamp 1.8rem→3.5rem, min-width buttons
  clamp 140→180px

### Replay
- [ ] Result Overlay en replay : à décider en début de port
  (recommandation : non pour Sprint 1)

---

## 7. Recommandations d'ordre de travail

**Sprint 0 — Prérequis cross-specs (partagé) :**
1. Tokens à ajouter dans `_tokens.scss` :
   - `--overlay-strong: rgba(15, 23, 42, 0.92)`
   - `--pvp-bg-dark-navy: #1a1a2e` (audit Wave 3)
   - `--pvp-result-victory-tint: rgba(76, 175, 80, 0.18)`
   - `--pvp-result-defeat-tint: rgba(244, 67, 54, 0.18)`
   - `--pvp-result-draw-tint: rgba(255, 193, 7, 0.18)`
   - `--pvp-result-disconnect-tint: rgba(8, 18, 38, 0.82)`
   - `--pvp-result-timeout-tint: rgba(30, 18, 4, 0.82)`
   - `--success-light: #66bb6a`
   - `--success-soft-40: rgba(76, 175, 80, 0.4)`
   - `--success-soft-70: rgba(76, 175, 80, 0.7)`
   - `--ease-bounce: cubic-bezier(0.2, 1.4, 0.4, 1)`
   - `--pvp-rematch-invited-gradient: linear-gradient(135deg, var(--success), var(--success-light))`
   - `--pvp-surrender-frame-gradient: linear-gradient(180deg, var(--overlay-strong), var(--pvp-bg-dark-navy))`
2. Keyframes à ajouter dans `_motion.scss` (préfixe `ds-`) :
   `ds-result-overlay-enter`, `ds-result-title-slam`,
   `ds-result-reason-rise`, `ds-result-btn-fade`,
   `ds-rematch-invited-pulse`.
3. Coquille `DuelDevHubComponent` + `DuelDevStateService` (cf spec
   board §8).

**Sprint 1 (1-2 jours) — Surrender :**
1. Refonte du `<ng-template #surrenderDialog>` avec partial DS
   `.btn .btn--danger .btn--md` (Surrender) + `.btn .btn--primary .btn--md`
   (Cancel)
2. SCSS `.surrender-dialog` (conteneur uniquement, plus de
   `.surrender-btn` — DS partial fournit)
3. Override Material `.pvp-dialog-panel--danger .mat-mdc-dialog-container`
4. Implémenter onglet End-flow du hub avec catégorie H + dry-run flag
   dans `confirmSurrender(opts?: { dryRun?: boolean })`
5. Vérif clavier (Tab, Enter, Escape)

**Sprint 2 (1-2 jours) — Result Overlay + polish + cleanup :**
1. Refonte HTML inline dans `duel-page.component.html` (partial
   `.btn--ghost` + `.btn--primary .is-invited`)
2. Réécriture complète de `.result-overlay` dans
   `duel-page-overlays.scss` (tokens, plus aucun hex/rgba)
3. Suppression `backToDeck()` méthode + clé i18n + bouton HTML
   (3 sites vérifiés safe, cf §3.6)
4. Tests des 6 variantes (victory/defeat/draw × normal/cause-disconnect)
   + invited pulse via onglet end-flow
5. A11y pass : screen reader, keyboard tab order, autofocus Leave
6. Retrait dev hub (après validation finale, commun aux 3 specs)

Total estimé : **2-3 jours** (1 dev). Sprint 0 partagé compte une
seule fois sur les 3 specs.

---

## 8. Dev Hub — onglet End-flow (extension de `duel-board-enrichment-spec` §8)

**Owner du hub :** `duel-board-enrichment-spec-2026-05-17.md` §8. Cette
section décrit **uniquement l'onglet End-flow** + ses fixtures et le
mode dry-run du surrender.

### 8.1 Composant onglet

**Path :** `front/src/app/pages/pvp/duel-page/duel-dev-hub/tabs/end-flow-tab.component.{ts,html,scss}`

**Selector :** `app-duel-dev-hub-end-flow-tab`

Rendu uniquement quand l'onglet `End-flow` est actif dans le hub. Aucun
gating ni listener clavier indépendant — le hub parent gère ça.

### 8.2 Signaux consommés via `override()`

Le service `DuelDevStateService` (§8.3 spec board) expose :
- `forcedResultOutcome: WritableSignal<DevResultOutcome | null>`
- `forcedRematchState: WritableSignal<DevRematchState | null>`

Le composant `duel-page.component.ts` consomme via le helper unifié :

```ts
private readonly devState = inject(DuelDevStateService);

readonly effectiveResultOutcome = computed(() =>
  this.devState.override(this.devState.forcedResultOutcome, () =>
    this.resultOutcome()  // calcul réel existant ligne 327
  )
);

readonly effectiveRematchState = computed(() =>
  this.devState.override(this.devState.forcedRematchState, () =>
    this.wsService.rematchState()
  )
);
```

Le HTML lit `effectiveResultOutcome()` / `effectiveRematchState()` au
lieu de `resultOutcome()` / `wsService.rematchState()` (changement
trivial, search & replace dans le template).

**Prod-safety :** factory `_signal()` neutralise `.set()` en prod →
les forced restent à `null` → `override()` retourne toujours le real.

### 8.3 Contrôles

**Catégorie H — Surrender Dialog (mode dry-run)**

- 1 bouton : `Open Surrender Dialog (dry-run)`
- Action : appelle directement `this.dialog.open(this.surrenderDialogTpl, ...)`
  **depuis l'onglet**, en passant `{ data: { dryRun: true } }`. Le template
  surrender reste inchangé ; c'est `confirmSurrender()` qui doit lire
  `MAT_DIALOG_DATA.dryRun` et **court-circuiter l'envoi WS** si vrai.

```ts
// duel-page.component.ts — modification trivale de confirmSurrender()
confirmSurrender(opts?: { dryRun?: boolean }): Observable<boolean> {
  // ... existant ...
  return dialogRef.afterClosed().pipe(
    switchMap(confirmed => {
      this.surrenderDialogOpen = false;
      if (!confirmed) return of(false);
      if (opts?.dryRun) return of(false);  // <-- ajout, 1 ligne
      this.wsService.sendSurrender();
      // ... reste existant ...
    })
  );
}
```

Pas d'entrelacement complexe dev/prod — un seul flag `dryRun` traversé
en arg. Lisible, testable, retirable en 1 commit.

**Catégorie I — Result Overlay**

Liste de 7 boutons :

```
[ Victory normal       ]  → forcedResultOutcome = FIXTURE_VICTORY
[ Defeat normal        ]  → forcedResultOutcome = FIXTURE_DEFEAT
[ Draw normal          ]  → forcedResultOutcome = FIXTURE_DRAW
[ Victory disconnect   ]  → forcedResultOutcome = FIXTURE_VICTORY_DISCONNECT
[ Defeat timeout       ]  → forcedResultOutcome = FIXTURE_DEFEAT_TIMEOUT
[ Draw inactivity      ]  → forcedResultOutcome = FIXTURE_DRAW_INACTIVITY
[ Hide                 ]  → forcedResultOutcome = null
```

**Catégorie J — Rematch state**

Combo box (actif si Result overlay show) :
- `idle` (Rematch normal)
- `requested` (Waiting for opponent...)
- `invited` (Accept Rematch + pulse vert)
- `opponent-left` (Opponent left, disabled)
- `expired` (Room expired, disabled)

Action : `devState.forcedRematchState.set(state)`.

### 8.4 Fixtures — pattern factory

**Path :** `front/src/app/pages/pvp/duel-page/duel-dev-hub/tabs/end-flow-fixtures.ts`

Même approche que prompts §9.5 — factory pour éviter la dérive.

```ts
import { DevResultOutcome } from '../duel-dev-state.service';

function makeResult(
  outcome: DevResultOutcome['outcome'],
  cause: string,
  reason: string,
): DevResultOutcome {
  return { outcome, cause, reason };
}

export const FIXTURE_VICTORY = makeResult(
  'victory', 'lp_zero', 'DragonSlayer92 — LP reduced to 0'
);
export const FIXTURE_DEFEAT = makeResult(
  'defeat', 'lp_zero', 'You — LP reduced to 0'
);
export const FIXTURE_DRAW = makeResult(
  'draw', 'lp_zero', 'Both LP reduced simultaneously'
);
export const FIXTURE_VICTORY_DISCONNECT = makeResult(
  'victory', 'disconnect', 'Opponent disconnected'
);
export const FIXTURE_DEFEAT_TIMEOUT = makeResult(
  'defeat', 'timeout', 'Turn timer expired'
);
export const FIXTURE_DRAW_INACTIVITY = makeResult(
  'draw', 'inactivity', 'Both players inactive'
);
```

### 8.5 Critères qualité

Identique aux autres onglets (§8.5 spec board).

### 8.6 Ordre de livraison

1. **Sprint 1 End-flow** : onglet avec catégorie H + 3 fixtures
   I de base (victory/defeat/draw normal) — 4 boutons.
2. **Sprint 2 End-flow** : enrichir avec disconnect/timeout/inactivity
   + catégorie J (rematch).
3. **Sprint 3** : onglet complet, validation finale.
4. **Après ship complet (3 specs)** : suppression du dossier
   `duel-dev-hub/` — cf §8.6 spec board.

---

## 9. Points ouverts

- **Ordre boutons + autofocus** : Leave-first vs Rematch-first sur
  Result. Recommandation actuelle = Leave focused (anti-mistap, cohérent
  surrender). À valider visuellement Sprint 2.
- **Sons d'ambiance** : sound effect sur Victory / Defeat ?
  `SOUND-EFFECTS-GUIDE.md` (`front/src/assets/sfx/`) ne liste pas ce
  cas. Hors scope MVP.

---

## 10. Refs

- Mockup composants (surrender) : `_mockups/mockup-duel-in-game.html`
  vue Composants
- Mockup results : `_mockups/mockup-duel-in-game.html` vue Results
- Code surrender actuel : [duel-page.component.html:541](../../front/src/app/pages/pvp/duel-page/duel-page.component.html#L541),
  [duel-page.component.ts:847](../../front/src/app/pages/pvp/duel-page/duel-page.component.ts#L847)
- Code result overlay actuel :
  [duel-page.component.html:457](../../front/src/app/pages/pvp/duel-page/duel-page.component.html#L457),
  [duel-page-overlays.scss:110](../../front/src/app/pages/pvp/duel-page/duel-page-overlays.scss#L110)
- DS tokens : `front/src/app/styles/_tokens.scss`
- DS doctrine : [project_ds_token_doctrine](../../C:\Users\Axel\.claude\projects\c--Users-Axel-Desktop-code-skytrix\memory\project_ds_token_doctrine.md)
- Wave 3 audit : `_bmad-output/planning-artifacts/ds-wave-3-duel-audit-2026-05-15.md`
- Specs liées : `duel-board-enrichment-spec-2026-05-17.md`,
  `duel-prompts-refresh-spec-2026-05-17.md`
