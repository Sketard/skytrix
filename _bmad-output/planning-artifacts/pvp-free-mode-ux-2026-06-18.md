# PvP Free Mode — Spécification UX (éditeur de board sans drag)

**Date** : 2026-06-18
**Auteur** : Sally (UX) avec Axel
**Statut** : ✅ SPEC CONSOLIDÉE + REVUE ADVERSARIALE INTÉGRÉE (2026-06-18) — prête pour hand-off
**Révision 2026-06-18** : revue cynique → calque transparent écarté (remplacé par 1 `@Output`
`emptyZoneTap`), machine à états §4 complétée (7 transitions), parité mobile re-qualifiée
(capacité oui, feedback non), a11y v1 = live-region + clavier reporté v1b, corrections de
cohérence (#1 ré-arme, #2 swap libre, #16 attach XYZ dédié, mini-barre mobile détachée).
**Révision 2026-06-19 (session archi Winston — alignement sur la tech spec)** : audit-miroir
des capacités sim intégré (#18 SORT_CARD re-qualifié, mill/reveal/shuffle couverts), #16
complété (transfer XYZ), #11 compteurs précisés (hors-undo + décrément obligatoire), `emptyZoneTap`
re-compté (3 sites, 2 câblés P0), #12 coquille 6→7 corrigée, trajectoire « remplaçant du
simulateur » actée. Détail des décisions : tech spec §5.2/§5.4/§5.5/§6/§11.
**Doc parent (technique)** : [pvp-free-mode-2026-06-18.md](pvp-free-mode-2026-06-18.md)

> ### ⭐ Cadre (acté 2026-06-19) — ce mode libre REMPLACE le simulateur
> Le mode libre n'est pas une feature à côté du simulateur : c'est son **remplaçant**. Le
> simulateur actuel sera supprimé (rendu condamné) ; seul le `BoardStateService` +
> `CommandStackService` survivent. Niveau de parité visé pour le retrait : **essentielle**.
> Voir tech spec « Note de trajectoire » + §11 (chantier 2 + audit-miroir des capacités sim).

---

## 1. Résumé exécutif

Mode libre = **éditeur de board bac à sable** dans le PvP skytrix, réutilisant le plateau
PvP (`<app-pvp-board-container>`) **sans moteur OCG**, **sans drag-drop**. Mono-joueur,
pas de tours, pas de prompts, pas de victoire. But : reconstituer/figer un endboard avec
la qualité visuelle du plateau PvP.

**Le système tient en deux règles + une poignée de cas-limites explicites** (§4) :

1. **Le tap agit selon l'état**
   - tap carte (main / terrain / overlay) → **ARME** (re-arme si une autre était déjà armée)
   - carte armée + tap zone-slot → **POSE** (ou **SWAP** si occupée — swap libre, types non vérifiés)
   - carte armée + tap pile → **DÉPOSE** dedans
   - rien d'armé + tap pile → **OUVRE** l'overlay
   - double-tap carte → **INSPECT** (n'arme pas)
2. **Tout overlay est un sélecteur d'armement** : recherche-deck OU pile ouverte → tap
   carte dedans → elle s'arme → flux unique.

> ⚠️ « Zéro cas particulier » serait faux : voir §4 pour les 7 transitions non triviales
> (re-arme, double-tap sur carte armée, overlay en état armé, swap inter-types, attach XYZ,
> pile vide, tap-vide vs tap-raté). L'attach XYZ N'EST PAS un tap simple — c'est une action
> dédiée de la mini-barre (un tap simple sur un monstre XYZ armé = SWAP, comme tout le reste).

**Phrase-boussole** : *« Cherche → zone, cherche → zone. Tape pour prendre, re-tape pour
poser, double-tape pour regarder. »*

**Impact sur le PvP existant : QUASI-NUL** — un seul ajout au board partagé (un `@Output`
`emptyZoneTap` gaté, voir §7). Tout le reste de la logique vit dans la page dédiée.

---

## 2. Contraintes utilisateur (socle)

| Dimension | Décision | Implication design |
|---|---|---|
| **Cible** | Desktop + mobile **à parité de capacité, pas de feedback** | Geste de base = tap universel ; toute action est faisable des deux côtés. MAIS le feedback diffère : desktop a le curseur-fantôme qui suit (rétroaction spatiale continue) ; mobile ne l'a pas (pas de pointeur persistant) → il compense par la pastille armée + (v1b) un repli de feedback de zone. Cibles tactiles ≥ 44px **partout** (mini-barre mobile détachée — voir §8). |
| **Scénario primaire** | **Monter un board final rapidement** | Placement en masse prime. Geste le plus court, répété sans friction. Pas de menu à chaque pose. |
| **Scénarios secondaires (reconnus, non optimisés)** | Rejouer un combo pas-à-pas ; mobile une main | Le profil agressif (#2/#3/#4) optimise le scénario primaire et peut être hostile au pas-à-pas (zéro feedback de zone) — accepté en v1, undo en filet. **Hors-scope explicite** : board adverse / 2e joueur, jetons hors deck (cf. §10). |
| **Gestes** | **Redéfinir librement** (indépendant du PvP) | Le tap manipule, pas inspecte. Inspection découplée (double-tap). |
| **Profil** | **« Power-user fluide »** | Rapide, peu de garde-fous, sobre. Rendu acceptable par l'undo gratuit (§6). |

---

## 3. Les 18 décisions de design (référence)

| # | Sujet | Décision |
|---|---|---|
| 1 | Modèle de base | Tap = armer (toujours), main + terrain. Taper une AUTRE carte **ré-arme** (la nouvelle devient armée, l'ancienne est relâchée). |
| 2 | Zone occupée + carte armée | Swap (échange les deux). **Swap libre** : la compatibilité de type de zone N'EST PAS vérifiée (monstre↔zone S autorisé — bac à sable). |
| 3 | Main collante | Reste armée jusqu'à désarmement explicite (Échap / tap-vide hors-plateau / re-tap) OU jusqu'à ce qu'une autre carte soit tapée (#1, ré-arme). |
| 4 | Feedback zones | Halo sur la carte armée seul (PAS d'illumination du plateau) |
| 5 | Déplacer carte posée | Tap l'arme (modèle unique) |
| 6 | Inspection | Double-tap (indépendant, n'arme pas) |
| 7 | État de départ | Main de 5 cartes piochée (décor réaliste) |
| 8 | Amener une carte précise | Recherche dans le deck (moteur de construction) |
| 9 | Flux recherche | Sélection → s'arme direct → tap zone |
| 10 | Périmètre recherche | Deck du joueur uniquement (main+deck+extra+side) |
| 11 | LP / compteurs | In-situ (LP cliquables là où ils s'affichent, compteurs mini-barre). **Compteurs (révision 2026-06-19) : Map parallèle HORS du CommandStack → hors undo/redo → décrément (`ｰ` ou long-press) OBLIGATOIRE en v1** (tech spec §5.4 ; cf. §10). |
| 12 | Mini-barre | Desktop : ancrée à la carte. **Mobile : détachée, barre bas d'écran pleine largeur** (**7** cibles ≥44px = 308px ne tiennent pas au-dessus d'une carte — revue 2026-06-18, voir §8). |
| 13 | Vers une pile | Carte armée → tap la pile = dépose |
| 14 | Tap pile (dépose vs ouvre) | Contexte tranche (armé = dépose, sinon ouvre). Pile vide ouverte → overlay « pile vide » (pas de blocage). |
| 15 | Sortir d'une pile | Ouvrir = sélecteur (overlay → tap carte = armée) |
| 16 | Attach XYZ | **Action dédiée de la mini-barre** (« Attacher comme matériau »), PAS un tap simple. Tap simple sur monstre XYZ armé = SWAP (#2). **Transfer XYZ (révision 2026-06-19, audit-miroir T2)** : si la carte armée est déjà un *matériau* (armé depuis le peek XYZ), Attacher-XYZ → tap autre monstre XYZ = `transferMaterial` atomique. La mini-barre route attach vs transfer selon carte normale / matériau (tech spec §5.2). |
| 17 | Activer un effet | La POSE face-up en zone S atteint l'**état** ; une action mini-barre **« Activer »** rejoue en plus le flash `activateEffect` (anim sur place, hors travel — compatible v1a). Couvre le scénario PvP `IDLE_ACTION.ACTIVATE`. |
| 18 | Ordre dans les piles | **Ordre d'insertion seul en v1** : les cartes s'empilent dans l'ordre de dépôt. **Révision 2026-06-19 (audit-miroir)** : réordonner DANS une pile (`SORT_CARD`) = v1b — mais **le simulateur ne le fait PAS non plus** (`pile-overlay` a `cdkDragSortingDisabled=true`) → ce n'est PAS une régression vs le sim, juste une capacité absente des deux. En revanche shuffle/mill/reveal du deck SONT couverts en v1 par la mini-barre pile (T4, tech spec §6.2). |

---

## 4. Machine à états d'interaction

```
ÉTAT A : aucune carte armée (repos)
  • tap carte (main / terrain)         → ARME → ÉTAT B
  • double-tap carte                   → INSPECT (zoom), reste ÉTAT A
  • tap pile (GY/banni/extra/deck)     → OUVRE overlay → ÉTAT C
  • tap pile VIDE                      → OUVRE overlay « pile vide » → ÉTAT C
  • ouvrir la recherche (deck)         → ÉTAT C
  • tap LP                             → éditeur LP inline

ÉTAT B : carte armée (halo pulsant + indicateur contexte permanent)
  • tap zone-slot libre                → POSE. Reste ÉTAT B (main collante #3)
  • tap zone-slot occupée              → SWAP (libre, types non vérifiés). Reste ÉTAT B
  • tap pile                           → DÉPOSE dedans. Reste ÉTAT B
  • tap AUTRE carte (main/terrain)     → RÉ-ARME (#1) : la nouvelle est armée, l'ancienne relâchée. Reste ÉTAT B
  • mini-barre actions (sur la carte)  → Flip / ATK↔DEF / Activer / Détruire / Détacher / Attacher-XYZ / +Compteur (même set qu'en §8)
  • ouvrir la recherche / une pile     → ABANDONNE l'armement courant → ÉTAT C (pas de carte « en attente » cachée)
  • re-tap carte armée                 → DÉSARME → ÉTAT A
  • tap-vide HORS plateau / Échap      → DÉSARME → ÉTAT A
  • tap gouttière DANS le plateau      → NO-OP (reste armé ; ce n'est pas un « vide »)
  • double-tap carte armée             → tap1 = re-tap (DÉSARME) ; tap2 (<250ms) = INSPECT. Net : désarme + inspect → ÉTAT A

ÉTAT C : overlay ouvert (pile / pile vide / recherche-deck) = SÉLECTEUR
  • tap carte dans l'overlay           → ARME + ferme overlay → ÉTAT B
  • overlay vide (pile vide)           → aucune carte à armer ; fermer → ÉTAT A
  • fermer l'overlay sans rien armer   → ÉTAT A (l'armement éventuel a été abandonné à l'ouverture, cf. note)

TRANSVERSE
  • double-tap n'importe quelle carte  → INSPECT (à tout moment ; sur carte armée, voir ÉTAT B)
  • Ctrl+Z / Ctrl+Y (desktop), boutons (mobile) → UNDO / REDO
```

**Notes de désambiguïsation** (findings de revue 2026-06-18) :

- **Re-arme vs main collante** — #3 « collante » signifie *persiste tant qu'on ne touche
  rien d'actionnable*, PAS *verrou*. Taper une autre carte ré-arme (#1). Les deux règles
  ne se contredisent pas : #3 protège contre la perte d'armement passive (l'armement ne
  s'évapore pas tout seul), #1 gère le ré-armement actif.
- **Ouvrir un overlay en état B** — abandonne l'armement courant. Décision délibérée : pas
  de pile cachée de cartes « en attente », un seul `armedCard` à la fois. Si l'utilisateur
  voulait garder la carte, il ne devait pas ouvrir l'overlay.
- **Swap inter-types** — autorisé (bac à sable). L'adaptateur `CardInstance → CardOnField`
  DOIT produire un `position` bitmask + `overlayMaterials: []` valides même pour un monstre
  posé en zone S (sinon crash render, cf. contrat doc parent §5-bis). Le board rend l'art
  sans broncher ; la légalité YGO n'est pas du ressort de l'éditeur.
- **Attach XYZ** — jamais déclenché par un tap simple. Tap simple sur monstre XYZ armé =
  SWAP comme n'importe quel monstre. L'attach est une action explicite de la mini-barre,
  ce qui ferme l'ambiguïté « tap-sur-XYZ = swap ou attach ? ».
- **Tap-vide** — seul un tap HORS du plateau désarme. Le board n'a pas de handler sur les
  gouttières inter-zones, donc un tap raté y est naturellement un no-op (l'armement
  survit). Sur mobile où l'espace hors-plateau est mince, le ✕ de la pastille armée (§8)
  est le désarmement fiable.

---

## 5. Parcours utilisateur (bout en bout)

```
1. OUVERTURE
   Choix d'un deck → entrée mode libre.
   État initial : plateau vide + MAIN de 5 cartes piochée (décor). Indicateur prêt.

2. CONSTRUCTION D'UN ENDBOARD (le flux rapide)
   Ouvre la recherche (deck) → tape « Snake-Eye Ash » → la carte s'arme →
   tap zone M3 → posée. Mode placement reste actif.
   Re-ouvre recherche → carte suivante → zone. Rythme : cherche→zone, cherche→zone.

3. AJUSTEMENTS
   Tap carte posée → armée → tap autre zone = déplace (swap si occupée).
   Tap carte → mini-barre (ancrée desktop, bas d'écran mobile) → Flip / ATK↔DEF / Détruire / Attacher-XYZ / +Compteur.
   Attacher un matériau : armer le futur matériau → ouvrir la mini-barre → « Attacher comme matériau » → tap le monstre XYZ cible.
   Tap LP → éditeur inline +/−.
   Carte à mettre au GY → armée → tap pile Cimetière.
   Reprendre du GY → tap Cimetière (rien d'armé) → overlay → tap carte → armée → tap zone.

4. VÉRIFICATION
   Double-tap carte → inspect (zoom). Erreur ? Ctrl+Z (desktop) / bouton Undo (mobile).

5. RÉSULTAT
   Board figé, rendu avec la qualité visuelle PvP (indicateurs, plateau, overlays).
```

---

## 6. Filets de sécurité (obligatoires)

Le profil « power-user fluide » (#2 swap, #3 main collante, #4 halo seul) retire les
signaux de sécurité. Trois filets les compensent **sans sacrifier la vitesse** :

1. **Halo armé TRÈS visible** — élévation + glow pulsant, pas un liseré. C'est le signal
   principal que « je tiens une carte » (pas d'illumination de zones, #4). ⚠️ **Limite
   tactile** : le doigt qui tape la carte masque le halo pendant et juste après le tap →
   sur mobile le halo ne suffit pas seul, il est doublé par la pastille (#2 ci-dessous).
2. **Indicateur de contexte permanent** — desktop : curseur = carte fantôme qui suit (donne
   une rétroaction spatiale continue) ; mobile : pastille « 🃏 carte armée ✕ » ancrée à un
   coin stable. ⚠️ **Pas une parité** : le fantôme desktop dit *où* je pointe ; la pastille
   mobile dit seulement *qu'*une carte est armée, pas où. Combiné au #4 (zéro zone allumée),
   le mobile perd les deux signaux spatiaux. Compensation v1 : la pastille porte le NOM de
   la carte armée pour réduire la charge mémoire ; un feedback de zone optionnel (le
   mécanisme `highlightedZones` existe, cf. §9) est un repli v1b si les tests tactiles le
   réclament.
3. **Undo généreux** — `CommandStackService` (sim) fournit undo/redo **gratuitement**.
   La pose accidentelle = Ctrl+Z (desktop) / bouton Undo (mobile). **C'est ce qui rend le
   profil agressif acceptable** : l'interaction est rapide PARCE QUE l'erreur est triviale
   à annuler. ⚠️ La main collante (#3) signifie que CHAQUE tap après une pose reste
   interprété en état B jusqu'au désarmement — un tap d'inspection ou de navigation peut
   déclencher un swap/dépôt accidentel. L'undo couvre l'erreur ; il reste recommandé de
   désarmer (✕ / Échap) une fois la dernière carte posée.

---

## 7. Impact sur le PvP existant — QUASI-NUL (1 `@Output` ajouté)

**Question** : réutiliser le board PvP force-t-il à modifier le composant que le PvP live
utilise ? **Réponse (vérifiée code 2026-06-18 ; re-vérifiée 2026-06-19)** : **un seul `@Output`**
ajouté au board — `emptyZoneTap` — câblé par `(click)` sur les slots vides côté joueur. Tout
le reste de la logique vit dans la page dédiée (§7-bis). Risque de régression PvP **très faible**
(output inerte, aucun abonné PvP).

> ⚠️ **Correction 2026-06-19 (audit code)** : il y a **3** `<div class="zone-empty">`, pas 1
> (L200 adverse, L303 EMZ, L474 propre). Mono-joueur → on câble seulement les 2 sites P0
> (L474 propre + L303 moitié P0 `!emz.isOpponent`) ; **L200 adverse reste non câblé**. Détail
> + raison dans la tech spec §4. Le « 1 `@Output` » reste exact ; c'est le décompte des sites
> qui était faux.

> **Révision 2026-06-18 (revue adversariale)** : la version précédente proposait un « calque de
> capture transparent par-dessus le plateau ». **Écarté** : un calque `pointer-events: auto`
> couvrant tout le plateau intercepterait aussi les taps inspect / pile / carte, contredisant
> le tableau § « marche tel quel ». Vérification code : les handlers de clic sont sur des
> **sous-éléments** (`.zone-card` HTML:429, `.zone-pile` HTML:389/400), tandis que le slot
> vide `.zone-empty` (HTML:474) n'a **aucun** handler. Donc la POSE sur zone vide ne peut PAS
> passer par un channel board existant, mais peut être captée proprement par un `(click)` sur
> ce slot inerte — sans rien intercepter. Le calque est inutile.

### 7.1 Ce qui marche TEL QUEL (events board existants, non gated)

| Besoin UX | Channel board existant | Gate |
|---|---|---|
| Double-tap / long-press = inspect | `cardInspectRequest` (pvp-board-container:275) | fire en readOnly ET non-readOnly |
| Tap carte → ARMER | `cardInspectRequest` / `menuRequest` (:273/275) **réinterprétés par le parent** | le parent décide arme-vs-inspect selon le geste (simple/double) — PAS « tel quel » |
| Ouvrir une pile / déposer | `zonePillRequest` (:274) | **non gated** — fire toujours |
| Halo « carte armée » | porté par le parent (overlay sur la carte), pas par le board | indépendant du board |
| `actionablePrompt = null` | — | **ne casse pas les clics** : le board reste réactif |

> ⚠️ « Armer une carte » N'EST PAS un channel natif : le board n'a pas de notion d'armement.
> Le parent intercepte `cardInspectRequest` (et la fenêtre 250ms du §9) pour distinguer
> arme (tap simple) / inspect (double-tap). C'est une **réinterprétation**, pas du tel-quel.

### 7.2 Les 4 manques (pilotés serveur en PvP, absents sans moteur)

1. **Armer une carte** — n'existe pas (tap PvP = menu d'action OU inspect). → réinterprété parent.
2. **Déposer dans une zone-slot vide au tap** — `.zone-empty` n'émet rien. → **le seul ajout board** (`emptyZoneTap`).
3. **Mini-barre d'actions libre** — le menu PvP vient d'`actionableCards` (OCGCore), pas d'une liste qu'on définit. → overlay parent.
4. **Éditer les LP au clic** — LP en lecture seule (pilotés `MSG_DAMAGE`). → overlay parent ancré sur l'affichage LP.

### 7.3 STRATÉGIE : le parent orchestre, 1 seul ajout au board

3 des 4 manques vivent dans le **parent mode-libre** (page dédiée, §7-bis), 1 seul touche
le board. Cohérent avec la doctrine `structural-safety-over-upstream-gate` — l'exception
(`emptyZoneTap`) est minimale, inerte, et structurellement nécessaire (pas de channel
existant sur `.zone-empty`).

| Manque | Solution |
|---|---|
| Armer une carte | État `armedCard = signal(null)` dans le parent. Le parent intercepte `cardInspectRequest`/`menuRequest` et arme selon le geste. **Zéro modif board.** |
| Déposer dans zone-slot **vide** | **`@Output() emptyZoneTap = output<ZoneId>()`** câblé sur les `<div class="zone-empty">` côté joueur (**2 des 3 sites** : L474 propre + L303 EMZ-P0 ; L200 adverse non câblé — voir tech spec §4). Robuste (cible 44px naturelle alignée sur le slot, pas un calque fragile). **1 Output + (click) sur 2 sites.** Inerte en PvP (aucun parent PvP ne s'y abonne). |
| Déposer dans zone-slot **occupée** (swap) | Channel existant : tap sur `.zone-card` → `cardInspectRequest`/`menuRequest`, réinterprété parent en swap si une carte est armée. **Zéro modif board.** |
| Mini-barre d'actions | **Overlay parent** (desktop : ancré à la carte ; mobile : barre bas d'écran — §8). Pas un menu interne au board. **Zéro modif board.** |
| Éditer LP | Overlay/éditeur parent positionné sur l'affichage LP. **Zéro modif board.** |

**Le risque reste dans le code neuf et jetable du parent**, sauf l'unique `emptyZoneTap`
— minime et sans effet sur le chemin PvP.

### 7.4 Coût / dette
- **+** Risque PvP très faible : 1 `@Output` sur l'élément le plus inerte, board intact ailleurs.
- **+** Plus de calque transparent → plus de risque d'interception d'events (le défaut du plan précédent).
- **−** Le parent porte les overlays (mini-barre, LP, halo armé) + la réinterprétation des taps.
- **À surveiller** : la réinterprétation tap-simple-vs-double-tap (§9, fenêtre 250ms) doit
  cohabiter avec le long-press inspect que le board émet déjà (`appLongPress` HTML:431).

### 7.5 Alternative écartée (mise à jour)
« Calque de capture transparent par-dessus tout le plateau » : écarté (revue 2026-06-18) car il
intercepte inspect/pile/carte → contradiction interne + risque mobile. Remplacé par l'ajout
ciblé `emptyZoneTap` sur le slot vide inerte, qui ne capture que ce qu'aucun autre handler
ne réclame.
« 4 `@Input` + plusieurs `@Output` gatés dans le board » : écarté — alourdit le composant
fragile. On n'en retient **qu'un** (`emptyZoneTap`), structurellement indispensable.

---

## 8. Wireframes textuels (états clés)

### Repos — main de départ (ÉTAT A)
```
        ┌─────────────────────── PLATEAU PvP (mono-joueur) ──────────────────────┐
        │  [extra] [S1][S2][S3][S4][S5] [deck]                                    │
        │  [field] [M1][M2][M3][M4][M5] [GY]      [LP: 8000] ← cliquable (#11)    │
        │          [EMZ_L]   [EMZ_R]    [banni]                                   │
        └────────────────────────────────────────────────────────────────────────┘
   MAIN  [🂠 A][🂠 B][🂠 C][🂠 D][🂠 E]          [🔍 Recherche deck]  [↶ Undo][↷ Redo]
```

### Carte armée (ÉTAT B) — desktop
```
        Plateau identique. Indicateur permanent :  curseur = 🂠 carte fantôme qui suit
        MAIN  [🂠 A][✨B✨][🂠 C]...   ← B armée : halo pulsant + élévation (filet §6 #1)
        → tap une zone-slot = pose | tap pile = dépose | re-tap B / Échap = désarme
```

### Carte armée (ÉTAT B) — mobile
```
        Pastille ancrée (coin stable) :  [ 🃏 Snake-Eye Ash — armée ✕ ]
        ✕ = désarmer (cible tactile ≥ 44px). Le NOM est affiché car le halo sur la
        carte est masqué par le doigt au moment du tap (filet §6 #2).
```

### Overlay sélecteur (ÉTAT C) — recherche deck OU pile ouverte
```
   ┌──────────── 🔍 Recherche : "snake"  (deck du joueur) ──────────┐
   │  [🂠 Snake-Eye Ash] [🂠 Snake-Eye Oak] [🂠 Snake-Eyes Flamb...] │
   │  tap une carte → elle s'arme + ferme l'overlay → ÉTAT B        │
   └────────────────────────────────────────────────────────────────┘
   (même composant pour une pile ouverte : GY / banni / extra / deck)
```

### Mini-barre d'actions
```
   DESKTOP — ancrée à la carte armée/tapée :
   carte M3  ┌──────────────────────────────────────────────────────────┐
             │ [🔄 Flip][⟳ ATK/DEF][⚡ Activer][🗑][🔗 Détach][⛓ Attach][＋ Cpt] │
             └──────────────────────────────────────────────────────────┘

   MOBILE — barre flottante DÉTACHÉE, ancrée bas d'écran (pleine largeur) :
   ┌──────────────────────────────────────────────────────────────┐
   │  🔄  │  ⟳  │  ⚡  │  🗑  │  🔗  │  ⛓  │  ＋   ← 7 cibles ≥ 44px      │
   └──────────────────────────────────────────────────────────────┘
   Pourquoi détachée (revue 2026-06-18) : 7 boutons × 44px = 308px, impossible au-dessus
   d'une carte de ~60px. La barre desktop ancrée déborderait + masquerait les cartes
   voisines (risque de tap-arme accidentel). Sur mobile elle vit en bas, hors plateau.
   La carte cible reste signalée par le halo + la pastille armée (#12 ré-arbitré).
   ⚡ Activer = rejoue le flash d'activation (#17), n'agit pas sur l'état.
```

---

## 9. Notes d'implémentation (hand-off Amelia)

- **Conflit double-tap vs single-tap (#6 vs #1)** : armer au 1er tap **immédiatement**
  (réactivité), puis si un 2e tap arrive dans ~250ms → annuler l'armement + inspecter.
  NE PAS attendre 250ms avant d'armer. ⚠️ L'annulation n'est PAS « invisible » : le halo
  (filet §6 #1) apparaît au tap1 et disparaît au tap2 → un bref flash de halo accompagne
  chaque double-tap. Acceptable, mais ne pas le décrire comme silencieux. Cette fenêtre
  doit cohabiter avec le `appLongPress` que le board émet déjà (HTML:431) pour l'inspect
  mobile — décider lequel gagne sur appui prolongé (proposition : long-press = inspect,
  cohérent avec le double-tap desktop).
- **POSE sur zone vide** : ajouter `@Output() emptyZoneTap = output<ZoneId>()` au board,
  câblé par `(click)` sur les slots vides côté joueur. C'est **le seul `@Output` ajouté au
  board** (cf. §7). ⚠️ **3 sites `.zone-empty`** (L200 adverse / L303 EMZ / L474 propre) —
  câbler les **2 sites P0** (L474 + L303 `!emz.isOpponent`), laisser L200 adverse intact.
  Détail dans la tech spec **§4**. Inerte en PvP (aucun abonné). NE PAS introduire de calque
  transparent (écarté revue 2026-06-18 — il intercepterait inspect/pile, voir §7).
- **Contrat adaptateur `CardInstance → CardOnField`** (doc parent §5-bis) : DOIT garantir
  sur **chaque** carte `overlayMaterials: []` + `position` bitmask valide + `chainPhase:
  'idle'` — sinon crash render / watchdog. Le swap inter-types étant autorisé (#2), un
  monstre peut atterrir en zone S : ces invariants doivent tenir **quel que soit** le couple
  (type-carte, type-zone), pas seulement sur les placements légaux.
- **A11y v1 — live-region** : brancher `DuelContext.announceEvent(text, player)`
  (LiveAnnouncer déjà câblé dans le pipeline) sur les transitions arme / pose / swap /
  dépôt-pile / désarme. Ex. « Snake-Eye Ash armée », « posée en zone Monstre 3 »,
  « échangée avec … ». **Navigation clavier complète (tab entre slots, espace=arme/pose,
  Échap=désarme) → reportée v1b** (cf. §10). Le « tap-vide » desktop n'a pas d'équivalent
  clavier en v1 — Échap est le seul désarmement clavier.
- **Réutilisation simulateur** (audit code 2026-06-18 — voir §9-bis) : les 3 composants
  sont **couplés à `BoardStateService` (+ `CommandStackService`)**, PAS purs. Ce n'est PAS
  bloquant : la page dédiée provisionne déjà ces 2 services (Option A, doc parent §7-bis) →
  les composants fonctionnent **sous le même bloc de providers**, sans adaptateur.
  - Recherche / pile ouverte → `simulator/pile-overlay.component.ts` (pilote `BoardStateService.activeOverlay*`).
  - Peek matériaux XYZ → `simulator/xyz-material-peek.component.ts` (pilote `activeMaterialPeek`).
  - Undo/redo + boutons → `simulator/control-bar.component.ts` + `CommandStackService`.
    ⚠️ Ce composant injecte AUSSI `Router` + `MatDialog` (flux reset → navigation/dialog) :
    vérifier au câblage qu'aucun comportement sim-spécifique (route, dialog de confirmation)
    ne fuit dans le mode libre — sinon en extraire une variante minimale.
  - Main de départ → `CommandStackService.drawCard` / `shuffleDeck` / `mill`.
- **Mini-barre d'actions** : composant flottant parent, icônes DS (`<app-icon-button>`).
  Actions = flip / toggle-position / **activer** / destroy (→ GY) / detach (XYZ) /
  **attach-XYZ** / add-counter. L'« attach-XYZ » arme un mode « tap le monstre XYZ cible »
  (pas un tap simple — décision #16). Layout : ancrée desktop, barre bas d'écran mobile (§8).
- **Action « Activer » (#17)** : appelle DIRECTEMENT `BoardEffectsService.activateEffect`
  sur l'élément de la carte — c'est une anim **sur place**, hors `QueueRunner`, donc
  **compatible v1a** (ne synthétise PAS de MSG_MOVE, ne fait pas de travel). Ne touche pas
  l'état du board (la carte est déjà posée face-up). ⚠️ Cf. backlog `faimena-activate-cost-overlap`
  : `activateEffect` peut résoudre sa Promise avant la fin visuelle des particules — sans
  travel concurrent en v1a, le risque est moindre, mais à vérifier au test.
- **Ordre des piles (#18)** : v1 = ordre d'insertion (push à la fin). Pas de réordonnancement.
  Le `CommandStackService` empile dans l'ordre des dépôts ; l'overlay de pile (§ réutilisation
  `pile-overlay`) affiche cet ordre. Réordonner (drag/flèches dans l'overlay, couvre le
  scénario PvP `SORT_CARD`) = v1b.
- **`highlightedZones`** : NON utilisé pour le placement en v1 (#4 halo seul), mais le
  mécanisme reste dispo — c'est le repli de feedback de zone évoqué au filet §6 #2 si les
  tests tactiles montrent que le halo+pastille ne suffisent pas (v1b).

---

## 9-bis. Couverture des actions OCGCore (audit 2026-06-18)

Audit croisé des 3 sources d'« action » du PvP normal contre le mode libre, pour garantir
qu'aucun scénario n'est oublié. Sources vérifiées dans le code :
`idle-action-codes.ts` (commandes idle/battle), `duel-ws-prompts.types.ts` (20 prompts
`SELECT_*`/`SORT_*`/`ANNOUNCE_*`), `simulator/commands/*` (moteur réutilisé Option A).

### Commandes idle/battle (`IDLE_ACTION` / `BATTLE_ACTION`)

| Action OCGCore | Mode libre | Mécanisme |
|---|---|---|
| Normal Summon / Special Summon / Set Monster / Set S-T | ✅ | POSE (tap zone) + flip pour le set. Le mode libre ne distingue pas le *type* d'invocation — il pose l'état final. |
| Change Position | ✅ | mini-barre ATK↔DEF (#5/#12) |
| Activate Effect (`IDLE_ACTION.ACTIVATE`) | ✅ | POSE face-up + mini-barre « Activer » (#17, flash) |
| Pendulum Summon (SS depuis scale) | ⚠️ partiel | l'état est atteignable carte par carte ; le geste « invoquer l'Extra en masse via les scales » n'existe pas (manuel par construction) — **accepté** |
| Battle Phase / Attack / End Turn | ❌ hors-scope | pas de tours ni de combat en mode libre (mono-joueur figé) |

### Prompts de résolution (`SELECT_*` / `SORT_*` / `ANNOUNCE_*`)

Le mode libre ne *déclenche* aucun prompt (pas de moteur) ; la question est : l'**état**
que chaque prompt produit en PvP est-il reconstituable à la main ?

| Prompt(s) | État produit | Reconstituable ? |
|---|---|---|
| `SELECT_PLACE` / `SELECT_DISFIELD` | zone de pose | ✅ POSE / `emptyZoneTap` |
| `SELECT_POSITION` | ATK/DEF/face-up-down | ✅ mini-barre + flip |
| `SELECT_TRIBUTE` | sacrifices → GY | ✅ armer → pile GY |
| `SELECT_CARD` / `SELECT_UNSELECT_CARD` / `SELECT_SUM` | cibler / déplacer | ✅ swaps + dépôts manuels |
| `SELECT_COUNTER` | retrait de N compteurs | ✅ décrément OBLIGATOIRE en v1 (révision 2026-06-19, #11) — compteurs hors-undo donc le `ｰ` est le seul recours |
| `SORT_CARD` / ordre GY-deck-banni | ordre dans une pile | ⚠️ réordon. = v1b — mais **le sim ne le fait pas non plus** (non-régression, pas une perte ; révision 2026-06-19) |
| `SELECT_CHAIN` / `SELECT_EFFECTYN` / `SELECT_YESNO` / `SELECT_OPTION` | décisions de timing/chaîne | ❌ non pertinent (pas de chaîne en mode libre) |
| `ANNOUNCE_RACE` / `ANNOUNCE_ATTRIB` / `ANNOUNCE_CARD` / `ANNOUNCE_NUMBER` | déclaration d'effet | ❌ non pertinent (pas d'effet à déclarer) |

**Verdict** : tous les scénarios PvP qui produisent un **état de board statique** sont
couverts par les 18 décisions. **Révision 2026-06-19** : le décrément de compteurs passe de
backlog à **obligatoire v1** (#11) ; le réordonnancement de pile (`SORT_CARD`) reste v1b mais
n'est PAS une régression (le simulateur ne le fait pas non plus). Les prompts de
timing/chaîne/déclaration sont hors du modèle « éditeur figé » par construction, pas des oublis.

---

## 10. Points hors-scope v1 (backlog UX)

- **Jetons** (tokens hors deck) — le périmètre recherche est « deck du joueur » (#10) ;
  poser un jeton générique n'est pas couvert. À spécifier si besoin.
- **Annuler une recherche en cours** (échap dans l'overlay) — trivial, à câbler.
- **Compteurs : décrément + types distincts** — la mini-barre fait « ＋Compteur »
  générique en v1. **Le décrément (long-press sur ＋ ou ｰ séparé) est OBLIGATOIRE en v1, plus
  un AU-MINIMUM** : décision archi 2026-06-19 (tech spec §5.4) — les compteurs vivent dans une
  Map parallèle **hors du CommandStack**, donc **hors undo/redo** ; un sur-clic n'est PAS
  rattrapable par Ctrl+Z, le décrément manuel est le seul recours → contrainte dure du filet
  §6. Types de compteurs distincts + affichage du total = v1b.
- **Navigation clavier complète** — tab/flèches entre slots, espace=arme/pose, Échap=désarme.
  v1 ne livre que la live-region (annonces SR, cf. §9). Cible desktop prioritaire → à
  prioriser tôt en v1b.
- **Perspective / 2e joueur / board adverse** — mono-joueur strict en v1 (cf. doc parent).
  Tester une interaction de ciblage adverse n'est PAS couvert.
- **Travel animé (v1b)** — v1 fait des sauts d'état (cf. doc parent §9).

---

## 11. Prochaines étapes

- **✅ Tech spec écrite** : [pvp-free-mode-tech-spec-2026-06-18.md](pvp-free-mode-tech-spec-2026-06-18.md)
  — signatures exactes, arbre fichiers, table de mapping ZoneId, routage transition→commande,
  diff `emptyZoneTap`, plan de tests. C'est le doc de hand-off Amelia.
- **✅ Audit réutilisation simulateur fait** (2026-06-18) : voir §9-bis — les 3 composants
  sim sont couplés à `BoardStateService` mais réutilisables sous les providers de la page.
- **Implémentation** : `bmad-dev-story` sur la tech spec. Ordre suggéré : §10 de la tech spec.
