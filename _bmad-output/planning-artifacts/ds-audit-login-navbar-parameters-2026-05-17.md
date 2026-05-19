# Audit DS — Login + Navbar + Paramètres

**Date** : 2026-05-17
**Branche** : `design-system`
**Scope** : Refonte 2026-05-16 (commits `0fd8da96` → `5645b5c4`)
**Méthode** : 3 audits parallèles (DS-conformité brute / cohérence inter-écrans / grep transverse)
**Fichiers audités** :
- [login-page.component.scss](front/src/app/pages/login-page/login-page.component.scss) + html
- [navbar.component.scss](front/src/app/components/navbar/navbar.component.scss) + html
- [parameter-page.component.scss](front/src/app/pages/parameter-page/parameter-page.component.scss) + html

---

## Verdict global

**Cohérence inter-écrans : Grade A**
**DS-conformité : ~96%** (très bon, 3 P0 réels à corriger, ~6 P1 cosmétiques)

Les 3 écrans s'intègrent proprement à la suite des refontes Lobby / Replay Hub / Replay Viewer. La composition `.btn`, le `.screen-bg` 4-layers, le `.page-header` avec icône + `.text-gold-gradient`, le `.section-header` à accent-bar gold, les `.pill --variant`, le rythme spacing `var(--space-*)` et les tokens d'élévation/transition sont tous correctement appliqués. Aucun `mat-flat-button` / `mat-raised-button` survivant. Aucun `box-shadow` literal. Aucun z-index numérique injustifié.

Les anomalies restantes sont **chirurgicales** : 3 hardcodes hors échelle (1 par écran) et un cluster d'icon-size `font-size: X !important` (5 sites au total) qui révèle un manque DS commun — pas une faute d'écran individuelle.

---

## P0 — Violations DS dures (à corriger)

### P0.1 — Navbar : scrim de drawer mobile non-tokenisé
[navbar.component.scss:457](front/src/app/components/navbar/navbar.component.scss#L457)
```scss
background: rgba(0, 0, 0, 0.6);
```
Le token `--scrim: rgba(5, 5, 10, 0.5)` existe précisément pour ce cas (overlays fullscreen). C'est le **seul rgba opaque hardcodé** des 3 écrans, donc isolé et facile à corriger.

**Fix** : `background: var(--scrim);`
(Si l'intention était un scrim plus opaque que les modales, créer `--scrim-strong: rgba(0, 0, 0, 0.6)` dans `_tokens.scss` et l'utiliser — la doctrine couleurs dit « en cas de doute, tokenise ».)

### P0.2 — Login : padding hors échelle sur les inputs custom
[login-page.component.scss:267](front/src/app/pages/login-page/login-page.component.scss#L267)
```scss
padding: 22px var(--space-4) 8px;
```
Le `22px` et le `8px` sortent de l'échelle `--space-*`. Le 8px est exactement `--space-2`. Le 22px est intentionnel (le label flottant doit tenir au-dessus de la baseline) mais reste un hardcode.

**Fix recommandé** : `padding: 22px var(--space-4) var(--space-2);` (au minimum), ou définir un token local SCSS `$label-offset: 22px;` documenté en commentaire ("floating label offset, height 56px input"). 22px n'a pas vocation à devenir un token DS partagé.

### P0.3 — Paramètres : gaps de 2px
[parameter-page.component.scss:100](front/src/app/pages/parameter-page/parameter-page.component.scss#L100)
[parameter-page.component.scss:122](front/src/app/pages/parameter-page/parameter-page.component.scss#L122)
```scss
.job-info { gap: 2px; }
.job-desc { margin-top: 2px; }
```
2px sort de l'échelle DS (minimum = `--space-1` = 4px). Soit ce sont des micro-ajustements typographiques qui doivent rester locaux mais documentés, soit ils doivent passer à `--space-1`.

**Fix** : `gap: var(--space-1);` et `margin-top: var(--space-1);` — l'œil ne verra pas la différence (2→4px sur du métadata stacking), et ça aligne sur le rythme DS.

---

## P1 — Cohérence (cluster icon-size + alias responsive)

### P1.1 — Cluster `font-size: Xpx !important` sur mat-icon (5 sites, 3 écrans)
[navbar.component.scss:234](front/src/app/components/navbar/navbar.component.scss#L234) — `font-size: 18px !important` (chevron lang)
[navbar.component.scss:300](front/src/app/components/navbar/navbar.component.scss#L300) — `font-size: 16px !important` (check lang option)
[navbar.component.scss:332](front/src/app/components/navbar/navbar.component.scss#L332) — `font-size: 18px !important` (chevron rotate)
[parameter-page.component.scss:64](front/src/app/pages/parameter-page/parameter-page.component.scss#L64) — `font-size: 18px !important` (page-header icon)
[login-page.component.scss:337](front/src/app/pages/login-page/login-page.component.scss#L337) — `font-size: 22px` (field-suffix eye toggle)

Ces 5 sites sont la **même problématique** : sizing de `mat-icon` qui doit battre la cascade `.material-icons { font-size: 24px }` par défaut. C'est un override Material légitime (les `!important` sont la convention skytrix pour ce cas, documenté DS-D9), mais c'est aussi le signal qu'il manque une mini-échelle d'icon-size dans `_tokens.scss`.

**Recommandation** (Wave 2 candidat, pas un fix immédiat) :
```scss
--icon-size-sm: 16px;   // dropdown items, inline indicators
--icon-size-md: 18px;   // page-header, chevrons, status icons
--icon-size-lg: 22px;   // input suffix, form interactions
--icon-size-xl: 24px;   // hero icons (= default Material)
```
Puis migration des 5 sites vers `font-size: var(--icon-size-md) !important;` etc. Conformité doctrine : 3+ usages → token (acquis ici).

Pas un blocker. À ranger dans le backlog Wave 2 à côté des composants Angular.

### P1.2 — Navbar : font-family Inter literal (2 sites)
[navbar.component.scss:205](front/src/app/components/navbar/navbar.component.scss#L205)
[navbar.component.scss:272](front/src/app/components/navbar/navbar.component.scss#L272)
```scss
font-family: 'Inter', sans-serif;
```
Le token `--font-body: 'Inter', sans-serif` existe.

**Fix** : `font-family: var(--font-body);`

### P1.3 — Paramètres : font-family JetBrains Mono literal (3 sites)
[parameter-page.component.scss:131](front/src/app/pages/parameter-page/parameter-page.component.scss#L131)
[parameter-page.component.scss:188](front/src/app/pages/parameter-page/parameter-page.component.scss#L188)
[parameter-page.component.scss:223](front/src/app/pages/parameter-page/parameter-page.component.scss#L223)
```scss
font-family: 'JetBrains Mono', ui-monospace, monospace;
```
Le token `--font-mono` existe.

**Fix** : `font-family: var(--font-mono);` partout. Bénéfice direct : si demain on change de mono, on touche 1 token au lieu de N fichiers.

### P1.4 — Navbar : font-size en `rem` non-aligné échelle (2 sites)
[navbar.component.scss:46](front/src/app/components/navbar/navbar.component.scss#L46) — `font-size: 0.45rem` (alpha-ribbon collapsed)
[navbar.component.scss:173](front/src/app/components/navbar/navbar.component.scss#L173) — `font-size: 0.5rem` (alpha-ribbon expanded)

Hors échelle `--text-xs..3xl`. L'alpha-ribbon est un cas micro-typographique (badge < 0.7rem), où l'échelle DS n'a effectivement rien à offrir. **Acceptable** comme local en l'état mais à surveiller : si un 2e composant a besoin d'un texte < `--text-xs`, créer `--text-2xs` plutôt que dupliquer le hardcode.

---

## P2 — Cosmétique / nice-to-have

### P2.1 — Paramètres : override `prefers-reduced-motion` local
[parameter-page.component.scss:275-277](front/src/app/pages/parameter-page/parameter-page.component.scss#L275)
```scss
@media (prefers-reduced-motion: reduce) {
  .progress-bar--indeterminate .progress-bar-fill { animation: none; width: 50%; }
  .btn-spinner { animation: none; border-top-color: var(--gold); }
}
```
La règle DS (`_a11y.scss`) couvre déjà `animation-duration: 0.01ms !important` globalement. Le commentaire inline (« local override only for safety ») explique l'intention : figer la barre indéterminée à `width: 50%` au lieu de la laisser invisible à `width: -100%`. **C'est légitime** — c'est un comportement *en plus* du reset global, pas une duplication. Le grep transverse l'a flaggé par méconnaissance du commentaire. **Aucun changement requis.**

### P2.2 — Login : `respond-below($bp-mobile)` (alias mixin local)
[login-page.component.scss:359](front/src/app/pages/login-page/login-page.component.scss#L359)

Le mixin existe et fonctionne, mais il n'est pas universel dans la base de code. Les autres écrans DS-conformes mélangent `respond-above/below` et `@media (max-width: var(--bp-*))`. À uniformiser un jour, mais clairement hors scope de cet audit.

### P2.3 — Login : 7 `rgba()` literals dans la constellation
[login-page.component.scss:53-54, 131, 139, 191, 268, 283](front/src/app/pages/login-page/login-page.component.scss#L53)

Tous documentés et sémantiquement spécifiques au background constellation (vignettes, blur layers, halo carte). Pattern unique au login, explicitement listé comme exception légitime dans la mémoire `project_login_parameters_refresh_2026_05_16`. **Aucun changement requis.**

---

## Cohérence inter-écrans — Tableau récap

| Axe | Login | Navbar | Paramètres | Référent | Verdict |
|---|---|---|---|---|---|
| Layout shell `:host` | constellation custom ✓ | n/a (composant) | standard ✓ | replay-hub:25 | **A** |
| `.screen-bg` 4-layers | constellation override ✓ | n/a | ✓ identique | replay-hub | **A** |
| Container max-width | n/a (form-card) | n/a | `--container-medium` ✓ | hub `wide`, lobby `narrow` | **A** |
| `.page-header` + icon + gradient | n/a | n/a | ✓ `settings_suggest` | replay-hub | **A** |
| `.section-header` accent-bar | n/a | n/a | ✓ | replay-hub | **A** |
| Boutons `.btn .btn--variant --size` | ✓ `--primary --lg --cta` | ✓ `--ghost --sm` | ✓ `--primary --md` + `--ghost --icon-only` | lobby/hub | **A** |
| Pills `.pill --variant` | n/a | n/a | ✓ helper `statusPillClass` | hub | **A** |
| Inputs | `.field` custom (justifié) | n/a | n/a | hub utilise Material | **B** (exception OK) |
| Skeleton vs spinner | n/a | n/a | spinner inline bouton OK | hub skeleton | **A** |
| Motion tokens | ✓ + keyframes locales constellation | ✓ + keyframe `lang-menu-in` | ✓ + keyframes locales progress | viewer mêmes patterns | **A** |
| Z-layers tokens | z:0 bg / z:1 content | `z.$z-*` partout | implicite ✓ | _z-layers.scss | **A** |
| Spacing rhythm | ✓ | ✓ | ✓ `gap: var(--space-6)` | hub | **A** |

---

## Stats brutes (3 fichiers SCSS)

| Catégorie | Login | Navbar | Paramètres | Total | Verdict |
|---|---|---|---|---|---|
| Hex couleurs hardcodés | 0 | 0 (1 en commentaire) | 0 | 0 | ✓ |
| rgba hardcodés | 7 (constellation justifiée) | 1 (P0.1) | 2 (param élévation locale) | 10 | 1 violation isolée |
| px hardcodés | 50 | 72 | 29 | 151 | ⚠️ cluster icon-size + animations |
| rem hardcodés | 0 | 2 (alpha-ribbon) | 1 | 3 | OK |
| `!important` | 0 | 7 (override Material) | 3 (override Material) | 10 | OK (convention skytrix) |
| z-index numérique | 3 (constellation, 0/1) | 4 (via tokens `z.$z-*`) | 0 | 7 | ✓ |
| `box-shadow` literal | 0 | 0 | 0 | 0 | ✓ |
| transition durée literal | 0 | 0 | 1 (progress 600ms) | 1 | OK isolé |
| `font-size` literal | 1 (P0.2) | 7 (cluster icon-size + alpha-ribbon) | 4 (3× cluster + 1 inline) | 12 | ⚠️ P1.1 |
| `font-family` literal | 0 | 2 (P1.2) | 3 (P1.3) | 5 | ⚠️ trivial à fixer |
| `prefers-reduced-motion` local | 0 | 0 | 1 (P2.1 justifié) | 1 | ✓ après examen |
| `mat-flat/raised/icon-button` HTML | 0 | 0 | 0 | 0 | ✓ |

---

## Bonnes surprises (à ne pas perdre)

- **Login : composition CTA `.btn .btn--primary .btn--lg .btn--cta .btn--cta-shimmer .btn--full`** — empile 5 modifiers DS sans conflit. Exemple parfait de la doctrine partials-as-utility-classes.
- **Paramètres : `statusPillClass(key)`** — un helper TS qui retourne la composition `.pill .pill--neutral|cyan|warning|danger.pill--live` selon l'état du job. Pattern réutilisable pour tout écran avec status dynamique.
- **Login : pattern logo glow** — `drop-shadow(0 0 28px var(--gold-soft-40)) drop-shadow(0 8px 24px rgba(0,0,0,0.5))`. Codifié dans la mémoire `project_login_parameters_refresh_2026_05_16`, à réutiliser sur tout futur écran premium.
- **Navbar : alpha-ribbon migré orange → gradient gold-700/900** — élimine la divergence palette `--alpha-badge-bg #e67e22` historique. À noter : le token `--alpha-badge-bg` est désormais orphelin sur cet écran (toujours utilisé ailleurs ?), à grep en Wave 3.
- **Paramètres : `timer(0, 2000)` au lieu de `interval(2000)`** — fix UX : la barre apparaît < 200 ms après clic au lieu d'attendre 2 s. Pattern à dupliquer partout où il y a polling après action utilisateur.

---

## Plan d'action recommandé

**Quick wins (< 30 min, à faire maintenant)** :
1. P0.1 : navbar `rgba(0,0,0,0.6)` → `var(--scrim)` (1 ligne)
2. P0.3 : paramètres 2× `2px` → `var(--space-1)` (2 lignes)
3. P1.2 : navbar 2× `font-family: 'Inter', sans-serif` → `var(--font-body)` (2 lignes)
4. P1.3 : paramètres 3× `font-family: 'JetBrains Mono'...` → `var(--font-mono)` (3 lignes)

**Décision à prendre** :
5. P0.2 (login padding 22px/8px) : valider l'intention (token local SCSS `$label-offset` documenté vs migration partielle vers `var(--space-2)` pour le 8px). Recommandation : `var(--space-2)` pour le 8px, hardcode `22px` documenté en commentaire pour le 22px.

**Backlog Wave 2** :
6. P1.1 (cluster icon-size mat-icon) : créer `--icon-size-sm/md/lg/xl` dans `_tokens.scss`, migrer 5 sites. Doctrine 3+ usages → token acquise.

**À ne PAS toucher** :
- Constellation login (P2.3) : exception légitime.
- `prefers-reduced-motion` paramètres (P2.1) : safety override volontaire.
- `respond-below` (P2.2) : pas un problème DS, problème de mixin transverse, hors scope.
- `!important` sur mat-icon : convention skytrix documentée DS-D9.

---

## Mise à jour mémoire suggérée

Le bilan « 100% DS-conforme » dans [project_login_parameters_refresh_2026_05_16](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_login_parameters_refresh_2026_05_16.md) (tableau §DS-conformité finale) mérite un ajustement post-audit : 3 P0 réels + cluster icon-size identifié. Note recommandée : `**~96% DS-conforme** — 3 P0 chirurgicaux fixés post-audit 2026-05-17 (cf. ds-audit-login-navbar-parameters-2026-05-17.md), cluster icon-size renvoyé en Wave 2`.
