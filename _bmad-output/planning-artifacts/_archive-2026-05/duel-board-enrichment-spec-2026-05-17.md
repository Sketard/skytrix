# Duel Board Enrichment · Implementation Spec

**Date :** 2026-05-17
**Author :** Sally (UX Designer)
**For :** dev agent (Amelia / `bmad-quick-dev`)
**Status :** ✅ UX validated · ready to port
**Mockups de référence :**
- `_mockups/mockup-duel-timer-phase.html` — composants phase pill + timers
- `_mockups/mockup-duel-themes.html` — système de thèmes paramétriques
- `_mockups/mockup-duel-in-game.html` — plateau v2 actuel (pixel-perfect base)

---

## 1. Contexte

Cette spec couvre **deux changements UX validés** sur le plateau PvP/Replay :

1. **Refonte du composant Timer + Phase** (qui était sur un seul disque central col 4
   → maintenant éclaté en 3 composants : phase pill compact central + timer player
   + timer opp brouillé).
2. **Système de thèmes paramétriques** (Classic / Cosmic / Forest) qui colorent
   l'ensemble du plateau via des tokens CSS scopés `--duel-*`.

Les deux sont indépendants en implémentation mais **partagent les mêmes tokens** :
le composant phase pill et les timers consomment `--duel-accent-primary` et
`--duel-accent-soft`, donc ils s'adaptent automatiquement au thème actif.

---

## 2. Composants visuels à porter

### 2.1 Phase pill centrale

**Position :** col 4 du `central-strip` (entre EMZ-L et EMZ-R), `justify-self: center`,
`align-self: center`. Compact (~80×28px) pour ne **jamais** déborder sur les EMZ
adjacentes (validé via cartographie du plateau v2 dans
[mockup-duel-board-empty-spaces.html](../../_mockups/mockup-duel-board-empty-spaces.html)).

> **Exception touch-target documentée :** la hauteur 28px viole
> `var(--touch-target-min)` (44px). Décision UX assumée : la pill est un
> *indicateur* en lecture quasi-permanente avec interaction d'appoint
> (changement de phase). Étendre sa hot-zone via un `::before` invisible
> `inset: -8px 0` pour atteindre 44px de surface cliquable sans agrandir
> visuellement le composant. Cf [project_ds_token_doctrine](memory) §
> exceptions geometry locale.

**Structure HTML :**

```html
<button class="phase-pill" [attr.disabled]="!isOwnTurn() || null">
  <span class="phase-pill__turn">T {{currentTurn()}}</span>
  <span class="phase-pill__sep"></span>
  <span class="phase-pill__name">{{phaseShort()}}</span>
  <span class="phase-pill__chev">▾</span>
</button>
```

**Variantes :**
- **Mon tour** → gold, cliquable, hover scale 1.04, glow renforcé
- **Tour adverse** → cyan (`--pvp-lp-opponent`), passif (`pointer-events: none`),
  pas de chevron visible, juste indicateur de phase

**Comportement clic :**
- Mon tour, phase non bloquée → ouvre menu phases disponibles (existant)
- Tour adverse → no-op (passif, lecture seule)

**CSS de référence :** voir `mockup-duel-themes.html` (sélecteur `.phase-pill`).

### 2.2 Timer player (collé sous duelist player)

**Position :** absolute, `bottom: calc(var(--space-2) + 48px)` (juste au-dessus de
la duelist card player), `left: var(--space-3)`. Min-width 64px.

**Structure :**

```html
<div class="timer timer--player"
     [class.is-green]="urgency() === 'normal'"
     [class.is-yellow]="urgency() === 'soon'"
     [class.is-red]="urgency() === 'urgent'"
     [class.timer--dimmed]="actor() !== 'me'"
     [style.--p]="progressPercent()">
  <span class="timer__row">
    <span class="timer__icon">schedule</span>
    <span class="timer__value">{{timeFormatted()}}</span>
  </span>
  <span class="timer__bar"><span class="timer__bar-fill"></span></span>
</div>
```

**États :**
- `is-green` (normal, valeur + barre verte)
- `is-yellow` (≤30s, jaune)
- `is-red` (≤10s ou état critique, rouge + pulse 0.8s)
- `timer--dimmed` (acteur courant = opp, opacity 0.5 + saturate 0.6)

### 2.3 Timer opp brouillé (collé sous duelist opp)

**Position :** absolute, `top: calc(var(--space-2) + 48px)`,
`right: calc(var(--touch-target-min) + var(--space-3))`.

**Règle gameplay critique :** la valeur exacte du timer adverse ne doit **jamais**
être lisible (info privée). Le brouillage est non négociable.

**Structure identique au timer player** mais avec classes `.timer--opp`. Le HTML
peut littéralement copier `mockup-duel-themes.html`. La valeur passée dans le
template peut être n'importe quoi (`'—:——'` ou la vraie valeur brouillée — le
brouillage 2C la rend de toute façon illisible).

**Brouillage 2C (variant choisie après comparaison de 6 variantes) :**
- `filter: blur(4px) opacity(var(--opacity-disabled))` sur `.timer__row`
  et `.timer__bar` (le `0.4` est exactement `--opacity-disabled`,
  réutiliser le token)
- `::before` = voile cyan dégradé
  `linear-gradient(135deg, var(--pvp-lp-opponent-soft-35), var(--cyan-500-soft-25))`
  — créer ces 2 tokens dans `_duel-tokens.scss` (le blu cyan vintage du
  brouillage est sémantique "info adverse masquée", token légitime)
- `::after` = hachures 45° fines (2px cyan + 4px transparent), couleur
  `var(--pvp-lp-opponent)` (token existant)

Fallback `@supports not (backdrop-filter: blur())` : reproduire
visuellement avec voile opaque `var(--pvp-lp-opponent-soft-35)` +
hachures plus contrastées (Safari iOS ≤ 14, faible part de marché en
2026 mais coût trivial).

**Pourquoi cette variante :** validation utilisateur après comparaison avec blur seul,
hachures larges opaques, hachures fines, static TV, frosted glass, glitch, silhouette
fantôme. 2C combine sémantique "info masquée" + esthétique premium frosted.

### 2.4 Bascule actor + duelist active

Le composant racine doit dériver un signal. Sources existantes dans
[duel-page.component.ts](../../front/src/app/pages/pvp/duel-page/duel-page.component.ts) :
- `isOwnTurn` (ligne 289) — `renderedState().turnPlayer === 0`
- `hasActivePrompt` (ligne 264) — fourni par `PromptDerivationService`,
  vrai dès qu'un prompt me demande de répondre (y compris pendant une
  chaîne adverse)

**Ownership :** `actor` vit sur `duel-page.component.ts` (à côté de
`isOwnTurn` et `hasActivePrompt`, ligne 289 / 264). Il est ensuite
**passé en input** à `pvp-board-container` qui le redrille vers les
sous-composants (`phase-pill`, `timer-player`, `timer-opp`,
`duelist-card-player`, `duelist-card-opp`). 2 niveaux de drilling — pas
de service partagé, pas d'injection contextuelle. KISS strict.

Formule concrète :

```typescript
// duel-page.component.ts
readonly actor = computed<'me' | 'opp'>(() =>
  this.hasActivePrompt() || this.isOwnTurn() ? 'me' : 'opp'
);
```

```html
<!-- duel-page.component.html -->
<app-pvp-board-container [actor]="actor()" ... />

<!-- pvp-board-container.component.html -->
<app-pvp-phase-badge [actor]="actor()" ... />
<app-pvp-timer-badge [actor]="actor()" variant="player" ... />
<app-pvp-timer-badge [actor]="actor()" variant="opp" ... />
<app-pvp-duelist-card [active]="actor() === 'me'" variant="player" ... />
<app-pvp-duelist-card [active]="actor() === 'opp'" variant="opp" ... />
```

Quand `actor()` change :
- `phase-pill` swap gold/cyan via `[class.phase-pill--opp]="actor === 'opp'"`
- `timer--player` / `timer--opp` togglent `.timer--dimmed`
- `duelist-card--player` / `duelist-card--opp` togglent
  `.duelist-card--active` / `.duelist-card--inactive` (glow renforcé sur l'active)

---

## 3. Système de thèmes paramétriques

### 3.1 Architecture

- Attribut `[attr.data-theme]` sur le **board host** racine (PvP + Replay)
- Chaque thème = un bloc de tokens CSS scopés à `.board-host[data-theme="X"]`
- HTML strictement identique entre tous les thèmes
- ~20 tokens namespacés `--duel-*` (cf liste section 3.3)

### 3.2 ThemeService

```typescript
@Injectable({ providedIn: 'root' })
export class DuelThemeService {
  readonly THEMES = ['classic', 'cosmic', 'forest'] as const;
  private readonly STORAGE_KEY = 'duel-theme';

  readonly currentTheme = signal<DuelTheme>(this.loadFromStorage() ?? 'classic');

  setTheme(theme: DuelTheme): void {
    this.currentTheme.set(theme);
    localStorage.setItem(this.STORAGE_KEY, theme);
  }

  private loadFromStorage(): DuelTheme | null {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    return this.THEMES.includes(stored as DuelTheme) ? (stored as DuelTheme) : null;
  }
}
```

Le composant racine PvP applique :

```html
<div class="board-host" [attr.data-theme]="themeService.currentTheme()">
  ...
</div>
```

**Important :** appliquer la même chose dans le **composant racine Replay**. La règle
*Replay Board State Parity* tient (les tokens sont CSS-only, indépendants des signaux
de jeu).

### 3.3 Liste des tokens à définir par thème

Chaque thème dans `_duel-themes.scss` définit :

```scss
.board-host[data-theme="classic"] {
  // Background base + ambiance
  --duel-bg-base: ...;
  --duel-bg-radial: ...;
  --duel-bg-overlay: ...;
  --duel-vignette: ...;

  // Matte pattern (texture overlay subtile sur tout le board)
  --duel-mat-pattern: ...;
  --duel-mat-pattern-opacity: ...;
  --duel-mat-blend: overlay | screen | soft-light;

  // Couleurs sémantiques
  --duel-accent-primary: ...;
  --duel-accent-soft: ...;

  // Zones de jeu (font partie de l'ambiance — décision UX validée)
  --duel-zone-border: ...;
  --duel-zone-bg: ...;
  --duel-zone-hover-glow: ...;

  // EMZ (extra monster zones, point focal)
  --duel-emz-bg: ...;
  --duel-emz-border: ...;
  --duel-emz-glow: ...;

  // Piles (deck, GY, banished, extra)
  --duel-pile-tint: ...;
}
```

**Valeurs de référence pour les 3 thèmes :** copier depuis `mockup-duel-themes.html`,
sélecteurs `.board-host[data-theme="classic|cosmic|forest"]`.

### 3.4 Animations idle par thème

Chaque thème peut définir une animation d'ambiance optionnelle via `.board-wrapper::before`
ou `::after`. Au port, **renommer avec le préfixe `ds-`** (convention skytrix Wave 1,
`_motion.scss` est la source unique des keyframes globales) et déclarer dans
`_motion.scss`, pas dans `_duel-themes.scss` :

- **Classic** : `ds-duel-theme-classic-shimmer 8s` halo gold qui respire
- **Cosmic** : `ds-duel-theme-cosmic-nebula 15s` + `ds-duel-theme-cosmic-twinkle 4s`
- **Forest** : `ds-duel-theme-forest-breeze 12s` + particules pollen flottantes

`_duel-themes.scss` ne fait que **consommer** ces keyframes via
`animation: ds-duel-theme-cosmic-nebula 15s ease-in-out infinite`.

**Toutes** doivent respecter `@media (prefers-reduced-motion: reduce)` (déjà dans le
mockup).

**Note parity floats (vérifié 2026-05-17) :** les keyframes idle s'appliquent sur
`::before` / `::after` du `.board-wrapper`. Les pseudo-elements **ne propagent pas**
leur `transform` aux descendants — les coordonnées des floats du `CardTravelEngine`
restent intactes. L'empilement est sûr également : pseudo-elements à `z-index: 0`,
floats à `z-index: 900` (`card-travel-engine.service.ts:280`). Aucune interférence
avec l'orchestrator.

### 3.5 Sélection du thème par l'utilisateur

**Phase 1 (MVP)** : un menu dans Paramètres → "Thème du plateau" avec radio buttons
Classic / Cosmic / Forest. Persiste en LocalStorage.

**Phase 2 (futur)** : thème lié au deck (un deck peut avoir un thème par défaut).
Hors scope MVP.

---

## 4. Contraintes architecturales

### 4.1 Animation Parity

**Zero impact** sur l'orchestrator. Les tokens sont CSS purs, lus par les sélecteurs
SCSS via `var(--duel-*, fallback)`. L'orchestrator continue de lire les signaux de jeu
via `AnimationDataSource` et `RenderedBoardStateService`.

### 4.2 Replay Parity

Le composant racine Replay applique le même `[attr.data-theme]` que PvP. Donc :
- Si l'utilisateur a sélectionné "Cosmic" → ses replays s'affichent en Cosmic
- Si le thème est lié au deck (phase 2) → le thème du deck du joueur s'applique

### 4.3 DS conformance

Les tokens `--duel-*` sont **scopés au plateau** (`.board-host[data-theme="*"]`).
Ils **ne polluent pas** le DS global (pas de modification de `--gold`, `--cyan`, etc.).
On peut consommer les tokens DS comme valeurs initiales (`--duel-accent-primary: var(--gold)`
pour Classic) — c'est la pratique recommandée.

### 4.4 Performance

Les animations idle (`cosmic-nebula`, etc.) sont sur `::before`/`::after` du
`.board-wrapper`, **pas** sur les zones de cartes. Aucune interférence avec les
animations de cartes (orchestrator).

`backdrop-filter: blur()` est utilisé dans le brouillage 2C — vérifier la perf sur
mobile (Safari iOS surtout). Fallback : `background: rgba(...)` opaque sans blur si
détecté lent.

---

## 5. Checklist de test en vrai

Une fois porté en Angular :

### Composants
- [ ] Phase pill rentre dans col 4 sans déborder sur EMZ (à tester avec EMZ-L et EMZ-R contenant des Links / XYZ — donc parties mid/late game)
- [ ] Timer player passe correctement par les 3 états (green/yellow/red) avec pulse rouge urgent
- [ ] Timer opp brouillé 2C reste **strictement illisible** (zoom in, screenshot, accessibility tool — la valeur ne doit jamais transparaître)
- [ ] Bascule actor (mon tour ↔ tour adverse) bien synchronisée avec le glow duelist
- [ ] Réponse à une chaîne adverse pendant mon tour : actor='me', mon timer reprend correctement

### Thèmes
- [ ] Switch Classic → Cosmic → Forest fluide (transition 600ms sur les couleurs)
- [ ] Toutes les zones de jeu prennent l'identité du thème (bordures, hover, EMZ)
- [ ] Phase pill et timers prennent automatiquement la couleur du thème (héritage tokens)
- [ ] Cartes en zones restent lisibles (contraste avec le nouveau fond)
- [ ] Animations idle ne créent pas de jank sur les animations de cartes en cours
- [ ] `prefers-reduced-motion` désactive bien les animations idle

### Persistance
- [ ] Reload de la page conserve le thème sélectionné
- [ ] Le thème s'applique dans Replay (même token sur composant racine replay)

### Accessibilité
- [ ] Phase pill : `aria-label` explicite ("Phase courante: Main 1, mon tour, cliquer pour changer")
- [ ] Timer opp : `aria-label="Opponent timer (hidden)"` pour signaler aux lecteurs d'écran que c'est intentionnellement masqué
- [ ] Toggle thème dans Paramètres : labels + aria

---

## 6. Recommandations d'ordre de travail

**Sprint 1 (composants seuls, thème = Classic en dur) :**
1. Extract Phase pill component (signal-based)
2. Extract Timer player + Timer opp (avec brouillage 2C)
3. Wire actor signal (`computed` depuis turn + chain state)
4. Test PvP + Replay → tout fonctionne avec couleurs gold actuelles

**Sprint 2 (système thèmes) :**
1. Créer `_duel-themes.scss` avec les 3 thèmes (tokens copiés du mockup)
2. Créer `DuelThemeService` + binding `data-theme` sur composant racine
3. Ajouter section Thème dans Paramètres
4. Test switch + persistance + replay parity

**Sprint 3 (polish) :**
1. Animations idle par thème (perf check)
2. Reduced motion
3. A11y labels + tests visuels
4. Éventuellement : thème par deck (phase 2)

---

## 7. Audit post-spec — vérifications faites le 2026-05-17

Trois points soulevés par Axel après réception de la spec — vérifiés dans le code live.

### 7.1 Risque de régression sur les animations CSS

**Vérifié — risque minimal.** Les composants `pvp-phase-badge` et `pvp-timer-badge`
existent déjà comme composants Angular avec `ViewEncapsulation` par défaut (sélecteurs
scopés). Leurs SCSS internes ne définissent ni n'invoquent aucune `@keyframes`. Aucun
fichier externe (board-container, _motion.scss, _tokens.scss) ne référence
`.phase-badge`, `.timer-badge` ou `.central-badges` dans une animation. Le keyframe
`badge-pulse` du board-container ne touche que `.zone-highlight-badge`, pas nos
composants. **Conclusion :** la refonte visuelle peut s'appliquer librement, aucune
animation ne dépend de la structure CSS actuelle de ces 2 badges. Garder le selector
Angular (`app-pvp-phase-badge`, `app-pvp-timer-badge`) pour conserver l'encapsulation.

### 7.2 Annonce des phases — refonte recommandée

**État actuel :** un service `PhaseAnnouncementService` existe déjà
([phase-announcement.service.ts](../../front/src/app/pages/pvp/duel-page/phase-announcement.service.ts))
qui :
- Maintient une **queue** d'annonces (drain avec délai 2000ms par annonce)
- Affiche un **overlay plein écran** via `pvp-duel-overlays` (signal `_announcement`)
- Annonce vocalement via `LiveAnnouncer` (préfixe "Adversaire — {{phase}}" si opp)
- Mappe les phases internes vers labels EN hardcodés (`DRAW → "Draw Phase"`, etc.)

**Problèmes identifiés :**
1. **PHASE_DISPLAY hardcodé en anglais** (`phase-announcement.service.ts:14-25`) — pas
   i18n alors que le reste passe par ngx-translate. Régression FR.
2. **Pas de cohérence visuelle avec la phase pill** — l'overlay grand a son propre
   style, la pill aura son style DS. Risque d'identité visuelle dédoublée.
3. **Annonce TOUTES les phases** (DP, SP, M1, BP, etc.) — bruit cognitif élevé. En
   pratique, seules les transitions **majeures** méritent un overlay (Battle Phase,
   End Phase, Tour de l'adversaire).
4. **Le `pvp-phase-badge` actuel n'annonce QUE sur clic** (`liveAnnouncer.announce()`
   ligne 94), pas sur réception du msg WS. Donc annonce dupliquée potentielle entre
   le service et le badge.

**Recommandations pour le port :**

a) **i18n des labels de phase** — déplacer `PHASE_DISPLAY` vers `assets/i18n/{fr,en}.json`
   sous `duel.phase.full.{DRAW, STANDBY, MAIN1, ...}`. Le service lit `translate.instant()`.

b) **Filtrer les phases annoncées** — n'envoyer en `show()` que les transitions
   significatives :
   - `BATTLE_START` (entrée BP, gros changement tactique)
   - `MAIN2` (sortie BP, retour aux invocations)
   - `END` (fin de tour explicite)
   - **Changement de joueur actif** (annonce "Tour adverse" / "À toi" — déjà couvert
     par `duel.a11y.opponentTurn` / `yourTurn` mais isolé du service phase)

   Les phases silencieuses (`DRAW`, `STANDBY`, sous-étapes du combat `BATTLE_STEP`,
   `DAMAGE`, `DAMAGE_CALC`) ne déclenchent **pas** d'overlay. Elles restent visibles
   dans le phase pill central, mais sans annonce vocale ni overlay.

c) **Aligner visuellement l'overlay avec la phase pill** — l'overlay grand reprend les
   tokens du thème actif (`--duel-accent-primary` pour mon tour, `--pvp-lp-opponent`
   pour opp). Même langage visuel des deux côtés.

d) **Retirer l'announce manuelle dans `pvp-phase-badge:94`** — c'est maintenant la
   responsabilité du `PhaseAnnouncementService`. Le badge se contente d'émettre l'action ;
   le service écoute le changement de phase WS et annonce.

e) **Optionnel** : ajouter un son discret à l'entrée en BP (souvent le moment-clef du
   tour) — le SOUND-EFFECTS-GUIDE.md mentionne déjà MSG_NEW_PHASE comme événement
   sonore prévu mais non implémenté. À discuter, pas bloquant.

### 7.3 Code propre lié au DS — checklist conformité

Pour respecter la doctrine [project_ds_token_doctrine](memory) déjà gravée :

- ✅ **Couleurs** : `--duel-accent-primary`, `--duel-accent-soft` (tokenisés).
  **Jamais** de hex dans le SCSS du badge (`#C9A84C` → `var(--gold)`).
- ✅ **Spacing** : utiliser exclusivement `var(--space-1..10)`. Hardcode `4px` /
  `12px` = drapeau rouge.
- ✅ **Typo** : `var(--text-xs)`, `var(--text-sm)`, `var(--text-md)` (clamp fluide DS).
  Hardcode `0.85rem` → trouver le token équivalent (`--text-sm`).
- ✅ **Radius** : `var(--radius-pill)`, `var(--radius-sm)`. Ne **pas** créer
  `--phase-pill-radius` (composant unique, geometry locale OK mais ici on a déjà des
  tokens DS qui font le boulot).
- ✅ **Transitions** : `var(--transition-fast)`, `var(--ease-out)`. Pas de durée hardcodée.
- ✅ **Z-index** : utiliser `z.$z-pvp-central-strip` ou créer un alias si besoin
  (`_z-layers.scss`). **Jamais** de `z-index: 80` en dur.
- ✅ **Font-family** : `var(--font-display)` pour titres / labels uppercase,
  `var(--font-mono)` pour timer valeur (tabular-nums).
- ⚠️ **Token `--pvp-phase-badge-font-size` legacy** — défini dans `_tokens.scss:335`,
  utilisé par le badge actuel. **Soit** le conserver et le redéfinir per-component
  (geometry locale légitime), **soit** le retirer si on bascule sur `--text-md`/`text-lg`
  fluide. Décision : le retirer, basculer sur `--text-md` (cohérent avec le reste du DS).
  Comparaison numérique vérifiée 2026-05-17 : legacy `clamp(0.875rem, 3dvh, 1.25rem)`
  (max 20px), `--text-md` `clamp(0.92rem, 0.88rem + 0.20vw, 1.00rem)` (max 16px).
  Réduction maîtrisée, le pill 28px de haut accepte largement. Si une taille plus
  généreuse s'avère nécessaire sur grand écran, basculer sur `--text-lg`. Note unité :
  passage de `dvh` (viewport-height) à `vw` (viewport-width) — comportement responsive
  légèrement différent en mobile portrait, à valider visuellement au Sprint 1.
- ⚠️ **Tokens `--duel-*` nouveaux** — créer un fichier `_duel-tokens.scss` dans
  `front/src/app/styles/` plutôt que polluer `_tokens.scss`. Importer dans `styles.scss`
  après `_tokens.scss`. Permet de garder le DS global propre et d'isoler le
  domaine "duel theming".

**Convention de nommage proposée** : `--duel-*` pour tout ce qui relève du plateau de
duel. Aucune collision avec `--pvp-*` (qui peut rester pour le reste du module PvP :
prompts, dialogs, hand). Les 2 espaces de noms coexistent mais ne se mélangent pas.

---

## 8. DuelDevHub (composant de review temporaire — owner des 3 specs)

**Objectif :** permettre à Axel de mettre le **vrai duel Angular** dans tous les
états visuels (thèmes, acteur, urgence, prompts, end-flow) sans avoir à jouer
un duel pour chaque cas. Composant **dev-only**, retiré ou gated en prod.

> **Owner cross-specs :** cette spec board est l'**owner** du
> `DuelDevHubComponent` et du `DuelDevStateService`. Les 2 specs liées
> (`duel-prompts-refresh-spec-2026-05-17.md` et
> `duel-end-flow-spec-2026-05-17.md`) **étendent** la définition ici en
> ajoutant des onglets et des signals `forced*` au service unique. Toute
> modification de la définition du service ou de la coquille du hub doit
> mettre à jour cette section.

### 8.1 Composant `DuelDevHubComponent`

**Path :** `front/src/app/pages/pvp/duel-page/duel-dev-hub/duel-dev-hub.component.{ts,html,scss}`

**Selector :** `app-duel-dev-hub`

**Gating :** rendu conditionnellement dans `pvp-board-container.component.html` via
`@if (devMode)` où `devMode = isDevMode()` (convention skytrix, cf
[duel-assert.ts:1](../../front/src/app/core/utilities/duel-assert.ts)).

**Forme visuelle :** floating panel fixe `top-right`, collapsable, ~320px de
large. 3 onglets : **Board · Prompts · End-flow**. Apparence sobre (tokens DS),
mais **identifié visuellement comme dev** via un header rouge/orange + label
"🔧 DEV HUB · remove before prod".

**Toggle clavier :** `Ctrl+Shift+D` pour show/hide (un seul listener global, un
seul raccourci — pas de `Ctrl+Shift+P` ni `Ctrl+Shift+E` parallèles).

### 8.2 Architecture en onglets

Trois onglets correspondant aux 3 specs :

```
┌──────────────────────────────────────┐
│ 🔧 DEV HUB                       [▾] │  (header rouge/orange)
├──────────────────────────────────────┤
│  Board  │  Prompts  │  End-flow      │  (3 tabs)
├──────────────────────────────────────┤
│  …contenu onglet actif…              │
└──────────────────────────────────────┘
```

Chaque onglet est un sous-composant indépendant :
- `DuelDevHubBoardTabComponent` (owned ici — voir §8.4)
- `DuelDevHubPromptsTabComponent` (owned par
  `duel-prompts-refresh-spec-2026-05-17.md` §9)
- `DuelDevHubEndFlowTabComponent` (owned par
  `duel-end-flow-spec-2026-05-17.md` §8)

Le hub n'est qu'une coquille de tabs + un listener clavier. Les 3 tabs
consomment et écrivent dans **un seul `DuelDevStateService`** (§8.3).

### 8.3 `DuelDevStateService` — définition consolidée

**Path :** `front/src/app/pages/pvp/duel-page/duel-dev-hub/duel-dev-state.service.ts`

**Définition canonique** — toute extension (onglet Prompts, End-flow) MUST
ajouter ses signals ici et étendre `reset()`.

```typescript
import { Injectable, isDevMode, signal, Signal, WritableSignal } from '@angular/core';
import { Prompt } from '../../types';

export type DevResultOutcome = {
  outcome: 'victory' | 'defeat' | 'draw';
  reason: string;
  cause: string;
};
export type DevRematchState =
  | 'idle' | 'requested' | 'invited' | 'opponent-left' | 'expired';

@Injectable({ providedIn: 'root' })
export class DuelDevStateService {
  // ─── Onglet Board (cette spec) ───────────────────────────────
  readonly forcedActor = this._signal<'me' | 'opp' | null>(null);
  readonly forcedTimerMs = this._signal<number | null>(null);
  readonly forcedChainPhase = this._signal<'resolving' | null>(null);
  readonly forcedOpponentDisconnected = this._signal<boolean | null>(null);
  readonly forcedLowLp = this._signal<boolean | null>(null);
  readonly forcedReadOnly = this._signal<boolean | null>(null);

  // ─── Onglet Prompts (duel-prompts-refresh-spec §9) ───────────
  readonly forcedPrompt = this._signal<Prompt | null>(null);

  // ─── Onglet End-flow (duel-end-flow-spec §8) ─────────────────
  readonly forcedResultOutcome = this._signal<DevResultOutcome | null>(null);
  readonly forcedRematchState = this._signal<DevRematchState | null>(null);

  /**
   * Helper : retourne le signal real si pas d'override, sinon le forced.
   * Évite la duplication du pattern `forced() ?? real()` sur chaque site.
   * Consommateurs utilisent :
   *   readonly actor = devOverride(devState.forcedActor, () => realActor());
   */
  override<T>(forced: Signal<T | null>, real: () => T): T {
    return forced() ?? real();
  }

  reset(): void {
    this.forcedActor.set(null);
    this.forcedTimerMs.set(null);
    this.forcedChainPhase.set(null);
    this.forcedOpponentDisconnected.set(null);
    this.forcedLowLp.set(null);
    this.forcedReadOnly.set(null);
    this.forcedPrompt.set(null);
    this.forcedResultOutcome.set(null);
    this.forcedRematchState.set(null);
  }

  /**
   * Factory privée — en prod, les signals sont créés mais leurs setters
   * sont des no-op (retournent toujours null). Le `.set()` est silencieux.
   * Résultat : `?? real()` court-circuite toujours en prod, zéro impact
   * sur le data flow réel. Le service reste injecté (providedIn: 'root')
   * mais inerte.
   */
  private _signal<T>(initial: T): WritableSignal<T> {
    const s = signal<T>(initial);
    if (!isDevMode()) {
      // En prod : neutraliser .set / .update (no-op silencieux)
      const noop = (() => {}) as WritableSignal<T>['set'];
      s.set = noop;
      s.update = noop;
    }
    return s;
  }
}
```

**Pattern de consommation côté `pvp-board-container` ou autre site** :

```typescript
private readonly devState = inject(DuelDevStateService);

readonly actor = computed<'me' | 'opp'>(() =>
  this.devState.override(this.devState.forcedActor, () =>
    this.hasActivePrompt() || this.isOwnTurn() ? 'me' : 'opp'
  )
);
```

Avantages :
- **Un seul pattern** réutilisé partout : pas de `?? real()` divergent
- **Prod-safe** : les setters sont neutralisés par `_signal()` — les
  forced signals restent à `null`, donc `override()` retourne toujours
  le real. Pas besoin de `?.` ou de gardes.
- **Service single-source** : un seul fichier à éditer pour ajouter un
  nouveau forced signal.

### 8.4 Onglet Board — contrôles

**Composant :** `DuelDevHubBoardTabComponent` (sous-composant du hub).

**Catégorie A — Thème de plateau**
- 3 boutons radio : `Classic` | `Cosmic` | `Forest`
- Action : `themeService.setTheme(theme)` (utilise le vrai service de prod)

**Catégorie B — Acteur courant (force le signal `actor`)**
- 2 boutons radio : `Moi` | `Adversaire`
- Action : `devState.forcedActor.set('me' | 'opp')`. Le bouton "reset"
  remet à `null` (override désactivé, calcul naturel reprend).
- Si "Adversaire" sélectionné : duelist player passe inactive, duelist opp active,
  phase pill passe en cyan, timer player se dim

**Catégorie C — Urgence timer player**
- 3 boutons : `Green (1:47)` | `Yellow (0:42)` | `Red 0:14`
- Action : `devState.forcedTimerMs.set(ms)` avec valeur calibrée
- Auto-désactivé si Acteur = Adversaire (un timer player a pas de sens en tour adverse)

**Catégorie D — Mock states (toggles indépendants)**
- ☐ `Chaîne en cours` — set `forcedChainPhase = 'resolving'`
- ☐ `LP < 1000 (danger)` — set `forcedLowLp = true`
- ☐ `Opponent disconnected` — set `forcedOpponentDisconnected = true`
- ☐ `Replay mode` — set `forcedReadOnly = true`
- ☐ `Phase announcement` — déclenche `phaseAnnouncementService.show()` avec un
  label random (action directe sur le service, pas via signal)
- ☐ `Reduced motion` — toggle classe `<body>` (action directe)

**Catégorie E — Phases (déclencher visuellement)**
- Boutons : `DP` | `SP` | `M1` | `BP` | `M2` | `EP`
- Action : `phase.set(phase)` côté board → met à jour le `phase-pill` central
- Bonus : auto-déclenche l'overlay `phase-announcement` correspondant

### 8.5 Critères de qualité

- ✅ **`isDevMode()` gate** sur le composant ET sur les setters du service
  (cf `_signal()` factory). Zéro impact sur le data flow prod.
- ✅ **Pas de tests unitaires** pour le hub ni les onglets — outil jetable.
  Marquer chaque fichier : `// DEV ONLY — to be removed before final ship.`
- ✅ **Suppression facile** : un seul import à supprimer
  (`@if (devMode) { <app-duel-dev-hub/> }` dans `pvp-board-container.component.html`)
  + suppression du dossier `duel-dev-hub/` (qui contient les 3 onglets + le service).
- ✅ **Visuel "warning"** : header rouge/orange explicite ("🔧 DEV HUB — remove
  before prod").
- ⚠️ **Persistance LocalStorage** : **éviter**. State in-memory uniquement,
  reset au refresh.
- ⚠️ **Vérif bundle prod** : `ng build --configuration production --stats-json`
  + analyse bundle pour confirmer tree-shake du dossier `duel-dev-hub/*`.
  Le service `DuelDevStateService` est `providedIn: 'root'` donc présent
  en bundle, mais ses signals neutralisés (~50 bytes par signal). Acceptable
  pour un Sprint, à supprimer au final ship.

### 8.6 Ordre de livraison

1. **Sprint 0 (prérequis)** → créer le squelette : `DuelDevStateService`
   complet (les 9 signals) + `DuelDevHubComponent` (coquille tabs vides) +
   listener `Ctrl+Shift+D`. Aucun onglet implémenté.
2. **Avant Sprint 1 Board** → implémenter `DuelDevHubBoardTabComponent`
   avec Catégories A + E uniquement (thèmes + phases).
3. **Pendant Sprint 1 Board** → enrichir Board tab avec B + C (acteur +
   urgence timer) au fur et à mesure que les composants sont portés.
4. **Sprint 3 Board (polish)** → enrichir Board tab avec D (mock states).
5. **Avant Sprint 1 Prompts / End-flow** → implémenter les 2 autres onglets
   (cf specs correspondantes).
6. **Après ship complet** → supprimer le dossier `duel-dev-hub/` + retirer
   l'import dans `pvp-board-container.component.html`. Un seul commit, propre.

---

## 9. Points ouverts (non décidés)

- **Timer en replay :** non affiché — état acquis, vérifié 2026-05-17 (aucun
  `pvp-timer-badge` dans `front/src/app/pages/pvp/replay/`). Pas de travail côté
  replay pour le port. Si demande future de réalisme (timer simulé), rouvrir ce point.
- **Sélection thème :** menu Paramètres pour le MVP. Plus tard : thème par deck ?
- **4ème thème ?** L'archi en supporte autant qu'on veut. Volcano / Ocean / Royal ont
  été mentionnés pendant l'exploration. À planifier après validation des 3 premiers.
- **Sons d'ambiance par thème ?** Hors scope MVP. À discuter si demande utilisateur.

---

## 10. Refs

- Mockup composants : `_mockups/mockup-duel-timer-phase.html`
- Mockup thèmes : `_mockups/mockup-duel-themes.html`
- Mockup plateau v2 actuel (base pixel-perfect) : `_mockups/mockup-duel-in-game.html`
- Cartographie espaces vides : `_mockups/mockup-duel-board-empty-spaces.html`
- Règles archi animation : `CLAUDE.md` (Animation Parity Rule, Replay Board State Parity)
- DS tokens : `front/src/app/styles/_tokens.scss`, [project_design_system_strategy](../../C:\Users\Axel\.claude\projects\c--Users-Axel-Desktop-code-skytrix\memory\project_design_system_strategy.md)
- Wave 3 audit : `_bmad-output/planning-artifacts/ds-wave-3-duel-audit-2026-05-15.md`
