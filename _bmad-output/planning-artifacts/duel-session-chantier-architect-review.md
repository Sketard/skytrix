---
title: Revue finale d'architecte — Chantier refonte pipeline d'animation
status: review (pré-bascule "draft → ready for implementation")
source_doc: duel-session-chantier.md (état 2026-05-25, 1018 lignes)
reviewed_satellites:
  - duel-session-chantier-critiques.md
  - poc-projection-spec.md + _bmad-output/poc-projection/decision.md
  - bug-solo-sequence.md
  - bug-cost-before-overlay-sequence.md
  - deferred-effects-catalogue.md
reviewer: Winston (agent BMad, rôle architecte)
date: 2026-05-25
---

# Revue finale d'architecte

## Verdict global

**Ready avec 5 corrections mineures + 3 questions ouvertes à trancher.**

Le cadrage est solide, défendable, et un dev sénior peut commencer α/β sans bloquer. Les 9 principes sont internement cohérents ; les satellites alignés ; les deux bugs caractérisés sont atteignables. Ce qui manque relève du polish d'implémentation, pas de la conception. Justification détaillée ci-dessous par question.

---

## 1. Cohérence interne (§3.1-3.9)

**OK globalement.** Les principes forment une cascade logique propre : §3.1 (flux unique) → §3.2 (3 natures) → §3.3 (events internes sur flux) → §3.4 (races) → §3.5 (scopes) → §3.6 (checkpoints) → §3.7 (deferred) → §3.8 (frontières) → §3.9 (coût). Pas de contradiction inter-§ détectée.

**Pseudo-code mentalement compilable** :
- §3.5 `BaseProjection<T>` — signature claire, mais voir Finding M1.
- §3.7 séquence Ash (lignes 446-459) — cohérente, le DeferredEffect émis à idx=5 référence un awaitingRef=6 qui n'arrive qu'après ; lookahead implicite (cf. Finding C1).
- §3.8 `BoundaryProcessor` — contrats opérationnels clairs, garantie flat OCGCore défendable.
- §5.2 `PerspectiveSource` — pseudo-code aligné au POC, invariants protégés.

**Findings cohérence interne** :

- **[MAJEUR] M1 — `BaseProjection.applyEvent` vs §3.6 checkpoint reset** (§3.5 lignes 350-358, §3.6 lignes 392-394). Le contrat `applyEvent(event: FluxEvent)` n'a pas de variant pour "checkpoint = repartir du payload". §3.6 dit *"elle doit repartir de zéro en utilisant le payload du checkpoint comme état initial"*, mais la signature ne le permet pas — il faudrait soit `applyReset(scopes, payload?)` avec payload typé, soit un événement `Checkpoint(payload)` distinct dans le flux. À nommer dans la spec d'implémentation.

- **[MINEUR] m1 — Asymétrie lookahead §1 vs §3.7** (lignes 82-89 vs 446-456). §1 dit *"la majorité des projections sont strict-pass"* puis cite §3.7 comme exception opt-in. Mais §3.7 ne marque jamais que la séquence Ash dépend du lookahead. Le DeferredEffect émis à idx=5 a-t-il besoin de connaître T6 d'avance (precomputed) ou est-il émis *après* observation de T6 (strict-pass) ? Implicite mais non dit. À clarifier en une phrase §3.7 ("le processor observe le flux post-facto, n'a pas besoin de lookahead").

- **[MINEUR] m2 — §3.4 type-2 races "structurellement impossibles" vs §3.5 enforcement runtime** (lignes 258-262 vs 365-370). §3.4 promet "structurellement", §3.5 admet *"vérifie en runtime (dev mode)"*. La garantie est en réalité **lint statique + assert runtime**, pas purement structurelle. Reformuler §3.4 *"impossibles modulo l'enforcement lint+assert"* serait plus honnête.

## 2. Cohérence avec les satellites

**OK globalement.** Les 5 satellites sont cités correctement, leurs verdicts intégrés, les deux séquences de victoire (T0-T10 SOLO, T0-T13 cost) sont atteignables par construction sous la cible. POC S3 figé en §5.2 conformément au `decision.md`.

**Catalogue deferred §3.7 vs deferred-effects-catalogue.md** :
- Doc cite "11 règles initiales" — le catalogue en liste effectivement 11. ✅
- §3.7bis cite 4 tests obligatoires + 4 scénarios casse = 8 — le catalogue propose 4 tests représentatifs des 7 familles (#1, #2, #8, #11). ✅
- **[MINEUR] m3 — Le catalogue mentionne "7 familles" (lignes 53-61) mais le doc §3.7 dit "7 familles" sans énumérer**. Lecteur doit aller au satellite. OK pour le ready, mais à inliner si on veut un cadrage autoporteur.

**Tests de victoire atteignables** :
- Bug SOLO (`bug-solo-sequence.md`) → §3.5 garantit `CONNECTION_LIFETIME` survit `PerspectiveSwitched` ; §4.1 ligne 735 acte single `DuelEventProcessor` par duel ; mécanisme cohérent. **Atteignable**.
- Bug cost-before-overlay (`bug-cost-before-overlay-sequence.md`) → §3.7 ε3 + R6 verdict structurellement différent ; ε3 supprime l'état mutable que les 4 tentatives manipulaient. **Atteignable**.

**Findings cohérence satellites** :

- **[CRITIQUE] C1 — Pairing T5↔T6 cost-before-overlay sous-spécifié**. Le satellite (`bug-cost-before-overlay-sequence.md §4`) dit le processor doit *"identifier T6 (MSG_MOVE qui suit immédiatement, avec player === T5.player et card === T5.card) comme awaitingRef"*. Le doc cadrage §3.7 ne décrit nulle part **comment** le processor reconnaît cette paire. Sans cette règle, le processor ne peut pas émettre `DeferredEffect('overlay-show', 4, 6)` à T5 — il ne sait pas que 6 va arriver. Deux options :
  1. **Lookahead-dependent** (mode Precomputed seulement) : le processor a accès aux events futurs, scanne pour la paire.
  2. **Strict-pass** : le processor émet `DeferredEffect` quand T5 arrive avec `awaitingRef='next-cost-by(playerN,cardX)'` (un prédicat), et matche à T6 par observation. C'est ce qui est implicite mais non dit.
  
  Cette ambiguïté est centrale — c'est la mécanique même de ε3 qui résout le bug. À clarifier dans la spec §3.7 avec une phrase explicite + au moins 2-3 exemples du catalogue détaillés (pas seulement #1 Ash).

## 3. Suffisance pour démarrer l'implémentation

**Suffisant pour α (5/5 dimensions), β (3/5), γ (4/5).** Un dev sénior peut commencer α immédiatement et préparer β. γ nécessite la résolution C1 + Q3 ci-dessous.

**Effort 30-45 j-h défendable** :
- Vérification par addition des items §4.1 : conservés (0+0+0+0+0+0+0)= 0j, wrappés (3-5+2-3+1-2+1-2+0-1+1-2+1-3+0-1+1-2) = 10-21j, SOLO reformé 5-7j, BufferReplay −5j, nouveaux processors (3-4+2-3+3-5) = 8-12j, infra 3-5j, spike 1-2j. **Total : ~22-42 j-h** → 30-45 j-h cohérent avec une marge raisonnable (~10% buffer + intégration). ✅ Défendable.
- POC chiffre 5-6.5j (§5.2 + decision.md §5) — déjà inclus dans γ.

**Manque pour α** : rien — le wrapping QueueRunner + scope dispatcher + projections requalifiées sont actionnables. Le spike info-hiding (parallèle) est chiffré.

**Manque pour β** :
- **C1** (pairing strict-pass vs lookahead).
- Spec du `EffectAbandoned` event (signature, qui le consomme).
- Lien explicite frontières §3.8 ↔ règles ε3 (le doc dit *"candidates naturelles"* lignes 580-583, mais aucune règle du catalogue n'utilise une frontière comme triggerRef).

**Manque pour γ** : 
- Plan d'exécution du switch interrupt-mid-DeferredEffect (cf. §3.7 réserve EC-39 *"checkpoint annule deferred"*, mais que se passe-t-il pour un `PerspectiveSwitched` qui n'est PAS un checkpoint et arrive pendant un deferred actif ?). 
- §3.5 dit deferred est `CONNECTION_LIFETIME` implicite (via R6 réserve), survit donc à `PerspectiveSwitched`. À expliciter dans la table §3.5 ligne 313 (pas listé aujourd'hui).

**Findings suffisance** :

- **[MAJEUR] M2 — Table §3.5 (lignes 313-323) n'inclut pas `pendingDeferredEffects`**. La séquence bug-SOLO §6 le mentionne, mais le tableau du doc cadrage ne le liste pas explicitement. À ajouter avec scope `CONNECTION_LIFETIME` pour cohérence.
- **[MINEUR] m4 — §4.3 Phase γ "Test bug SOLO doit passer" mais §4.1 ligne 735 (SoloDuelOrchestrator reformé) ne lie pas explicitement le single-processor à `bug-solo-sequence.md §4`**. La cohérence existe mais le lecteur doit faire le mapping. Une phrase suffit.

## 4. Pièges détectables a priori

**Trois pièges non catchés par les 3 passes + 8 investigations + POC** :

- **[MAJEUR] M3 — Coexistence V1↔V2 + état de scope partagé** (§4.5 lignes 793-808). Le feature flag `ANIM_PIPELINE_V2` est par session, mais §3.5 `SESSION_LIFETIME` survit aux deux côtés du flag. Si un utilisateur joue un duel V1 puis switch en V2 pour le suivant (rematch), les projections `SESSION_LIFETIME` (score BO3, opponent identity) doivent être lisibles par les **deux** implémentations. Le contrat de sérialisation cross-version n'est pas spécifié. Risque concret : score BO3 stocké en format V1 illisible par V2 → score reset au flag flip. À acter ou à confirmer "feature flag = redémarrage app" (rend le problème vacant).

- **[MINEUR] m5 — §3.7 collision de noms "interdite par invariant" vs cas #5 batch séquentiel**. §3.7bis lignes 539-542 dit *"deux DeferredEffect du même nom actifs simultanément sont interdits"*. Mais le catalogue cas #5 (`banish-then-revive` Necroface séquentiel) a une dépendance 1→N : chaque travel séquentiel attend le précédent. Si le naming est `banish-then-revive` sans index, il y a collision par construction. Soit le naming inclut un index (`banish-then-revive-3` pour le 3e), soit l'invariant doit être assoupli pour "même nom + même triggerRef". À spécifier dans la spec.

- **[MINEUR] m6 — Pas d'invariant testable sur l'absence de signal libre post-refactor**. §3.2 algorithme de décision (lignes 182-195) propose une convention de nommage + lint custom mais le lint n'est pas dans le scope du chantier (§3.2 ligne 205 dit *"à ajouter au scope du chantier"* en passant). Sans lint, le filet de sécurité repose sur revue manuelle. Coût lint custom ~0.5-1j, à inclure explicitement en α.

---

## Questions ouvertes à trancher avant bascule

1. **C1 / Q1 — Pairing ε3 : lookahead-dependent ou strict-pass ?** Comment le `DeferredEffectProcessor` reconnaît-il T5↔T6 sans connaître T6 d'avance ? Réponse implicite = strict-pass + prédicat, mais à acter explicitement dans §3.7. Bloque la spec d'implémentation β.

2. **M3 / Q2 — Contrat de sérialisation cross-V1↔V2 pour `SESSION_LIFETIME` ?** Soit on déclare "feature flag = redémarrage app obligatoire", soit on spécifie le format inter-version. La première option est moins coûteuse mais à acter explicitement en §4.5.

3. **γ / Q3 — `PerspectiveSwitched` mid-DeferredEffect : politique ?** §3.6 traite checkpoint, mais pas le switch perspective qui n'est pas un checkpoint. Trois options : (a) survit (deferred est `CONNECTION_LIFETIME`), (b) annulé via `EffectAbandoned`, (c) interdit (UI lock). À acter pour la spec γ. Recommandation perso : (a) cohérent avec §3.5 + bug-solo-sequence §4 lecture laxiste.

---

## Résumé FR (5-10 lignes)

Le chantier est **ready pour implémentation avec 5 corrections mineures + 3 questions ouvertes**. Les 9 principes sont internement cohérents, alignés avec les 5 satellites, et les deux tests de victoire (SOLO + cost-before-overlay) sont mécaniquement atteignables. Le chiffrage 30-45 j-h est défendable. Un dev sénior peut démarrer la phase α immédiatement ; les phases β et γ nécessitent de résoudre une ambiguïté sur le pairing ε3 (strict-pass vs lookahead, finding C1) et de clarifier la table de scope §3.5 (deferred effects manquants, finding M2). Le seul finding critique (C1) est éditorial : la mécanique de matching `DeferredEffect` n'est pas explicitée, alors qu'elle est centrale au verdict R6. Une fois ces 3 questions tranchées, le doc est `ready for implementation`. Aucune réécriture structurelle requise.

— Winston
