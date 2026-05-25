---
title: Plan d'action — Reprendre la rédaction du cadrage
status: actionable
source_docs:
  - duel-session-chantier.md (cadrage en cours, sections 1-4)
  - duel-session-chantier-critiques.md (arbitrage + investigations bloc 1 + bloc 2)
date: 2026-05-25
---

# Plan d'action — Reprendre la rédaction du cadrage

Après 3 passes de revue (edge-case, adversarial, pre-mortem) consolidées en 47 trous valides + 5 investigations unitaires statuées (R2, R5, R6, R8, EC-12), le cadrage peut reprendre sa rédaction. Ce document liste ce qui reste à faire, dans l'ordre où le faire, et ce que produit chaque action.

---

## §1 Tableau de bord — État de chaque risque/trou

Tu as 5 risques verdict ✅, 3 risques à investiguer encore, et un paquet de trous mineurs à traiter à la rédaction. Vue d'ensemble :

| ID | Statut | Action |
|---|---|---|
| **R2** Existant ignoré | ✅ Statué bloc 1 | QueueRunner conservé. Écrire section "Existant → Cible" |
| **R5** Débit non chiffré | ✅ Statué bloc 2 | §3.3 figeable. Chiffrer §3.9 (+3 events/event animatable, pic ~60 events/s) |
| **R6** ε3 vs 4 tentatives | ✅ Statué bloc 1 | ε3 valide. Intégrer 3 réserves (processor isolé/testable, §3.8 prérequis, 4 scénarios tests) |
| **R8** Asymétrie precompute/streaming | ✅ Statué bloc 1 | Marginal. Expliciter `LiveSource + Streaming` = strict-pass dans §1 reformulation |
| **EC-12** RAM long duel | ✅ Statué bloc 2 | BO1/BO3 OK. Documenter politique rétention "à acter en story" pour sessions > 2h |
| **R3** Spike info-hiding | 🔄 Bloc 3 (non lancé) | Investiguer si voulu, sinon : démarrer pipeline sur contrat de flux figé |
| **R1** POC projection seuils | 📝 Décision éditoriale | Acter seuils chiffrés (jump ≤ 1 frame, fps cible par device) |
| **R4** Caractériser bug SOLO | 📝 Rédaction ~1j | Produire 2 fichiers MD = séquences WS reproductibles + état attendu vs observé |
| **R7** Deadline + critères bascule draft→ready | 📝 Décision éditoriale | Acter deadline (proposé : 2026-06-01) + liste sections à écrire |
| **EC-26** Boundaries imbriquées | 🔄 Bloc 3 (non lancé) | Investiguer si voulu, sinon : choisir flat ou stack semantics à la rédaction §3.8 |
| **3 polish éditoriaux** | 📝 Au moment du commit final | Mot "découverte", numérotation §4, attribution "Winston" |
| **40 trous mineurs valides** | 📝 À la rédaction des sections | Cf. §2 ci-dessous — listés par section du cadrage |

---

## §2 Ordre de rédaction recommandé

Logique : remonter du gros (existant, scope, acceptance) vers le détail (mécaniques §3.X) pour qu'aucune section de détail ne soit écrite sans son cadre. Chaque étape produit un livrable concret.

### Étape A — Inputs à produire AVANT de toucher le doc (~3 jours, peuvent partir en parallèle)

| Action | Livrable | Coût | Adresse |
|---|---|---|---|
| **A.1** Caractériser bug SOLO + cost-before-overlay en séquences WS reproductibles | 2 fichiers `bug-solo-sequence.md` et `bug-cost-before-overlay-sequence.md` (séquence d'events WS exacte + état attendu + état observé) | ~1j | R4, ADV-3 |
| **A.2** Lister les 5-15 cas concrets de deferred effects connus | 1 fichier `deferred-effects-catalogue.md` (tableau cas / trigger / awaiting / exemple WS) | ~0.5j | R6 reformulé, ADV-11 |
| **A.3** Lister les scénarios in-flight animation que le POC perspective doit traiter | 1 fichier `poc-projection-scenarios.md` (5 scénarios reproductibles + seuils succès chiffrés par device) | ~0.5j | R1, EC-5, EC-33 |
| **A.4** (Optionnel) Bloc 3 — R3 spike info-hiding + EC-26 boundaries imbriquées | 2 verdicts | ~1j cumulé | R3, EC-26 |

A.1 + A.2 + A.3 = inputs durs requis pour la suite. A.4 est confortable mais peut être différé.

### Étape B — Écrire la section "Existant → Cible" (~1j, après A)

| Action | Livrable | Coût | Adresse |
|---|---|---|---|
| **B.1** Section "Existant → Cible" dans le doc cadrage | Tableau 8 composants × statut cible (conservé / wrappé / fusionné / jeté) + plan coexistence V1↔V2 | ~1j | R2, fusion EC-34+ADV-20+PM-C |

Composants à statuer : QueueRunner (✅ conservé + 2 adaptations), AnimationOrchestratorService, DuelEventProcessor, RenderedBoardStateService, 8 managers (Chain/Draw/Move/Lp/Battle/TargetIndicator/BufferReplayBuilder), CardTravelEngine, BoardEffectsService, FloatRegistryService.

### Étape C — Acter les décisions transverses (~0.5j, après A)

| Action | Livrable | Coût |
|---|---|---|
| **C.1** Acter deadline du cadrage + table des matières finale + critères bascule draft→ready | Section "Méta-cadrage" au début du doc | <0.5j |
| **C.2** Acter algorithme de décision projection / transport / `@Environment` | Reformulation §3.2 | <0.5j |
| **C.3** Acter lookahead comme propriété explicite de la dimension Transport + projections strict-pass vs lookahead-dependent | Reformulation §1 + §3.5 ou §3.6 | <0.5j |
| **C.4** Acter politique de rétention du flux (3 stratégies listées dans bloc 2) | Ajout §3.3 ou §3.9 | <0.5j |
| **C.5** Acter le boundary processor comme composant nommé + sync mandatory | Reformulation §3.8 | <0.5j |

### Étape D — Compléter les sections du doc cadrage (séquentiel, ~5-8j)

L'ordre suit la numérotation actuelle du doc, en intégrant les trous valides au passage.

| Section | Trous valides à intégrer | Coût estimé |
|---|---|---|
| **§1 reformulation** | EC-1, EC-2, EC-3 (matrice qualification combos), R8 explicitation strict-pass, ADV-1 (alternatives + trade-offs), ADV-3 (démonstration bug SOLO via A.1) | ~1j |
| **§2 Attributs de qualité** | EC-7 (convergence bornée), EC-8 (parité restreinte), ADV-4 (industrialisable mesurable), ADV-5 (races reformulée) | ~0.5j |
| **§3.1 Flux unique** | EC-9 (carve-out DOM/Environment) | ~0.5j |
| **§3.2 Projection/transport** | EC-10⊕EC-30⊕ADV-6 (algorithme décision), ADV-6 (sortir tautologie) | ~0.5j |
| **§3.3 Events internes sur flux** | EC-11 (ordering), EC-12 (politique rétention), EC-13 (timers events), ADV-7+ADV-8 (chiffrer + nuancer déterminisme), R5 (chiffres validés) | ~1j |
| **§3.4 Races** | Réécriture après ADV-5 (cf. §2) | déjà couvert ci-dessus |
| **§3.5 Scope persistance** | EC-14 (SESSION_LIFETIME), EC-15 (reset events), EC-16 (post-DuelEnded), ADV-9 (enforcement mécanique BaseProjection) | ~0.5j |
| **§3.6 Checkpoints** | EC-17 (in-flight events), EC-18 (payload partiel), EC-19 (policy enforcement), ADV-10 (race timestamp) | ~0.5j |
| **§3.7 Effets différés** | EC-20 (timeout), EC-21 (collisions), EC-22 (lookahead asymétrie), EC-24 (versioning), EC-39 (checkpoint mid-await), ADV-11 (5-15 cas via A.2), ADV-12 (3 composants YGO knowledge), R6 réserves (processor testable, §3.8 prérequis) | ~1.5j |
| **§3.8 Frontières** | EC-25 (sync mandatory), EC-26 (nesting), EC-27⊕EC-28 (closure + mismatch), ADV-13 (qui émet) | ~1j |
| **§3.9 Coût et discipline** | EC-29 (recompute cost), ADV-14 (chiffrer N projections, RAM, latency) | ~0.5j |
| **§4 Sujets connexes** | EC-31 (spike timebox), EC-32+EC-33+ADV-17 (POC seuils via A.3), ADV-2+ADV-15+ADV-18 (polish), R3 statut figé contrat de flux actuel | ~0.5j |
| **§5 Nouvelle — Acceptance + Migration** | EC-34⊕ADV-20⊕PM-C (existant→cible via B.1), EC-35 (testing strategy), EC-36 (cross-version replays), EC-37⊕ADV-19 (acceptance criteria + deadline via C.1), EC-38 (rollback feature flag) | ~1j |

**Total étape D : ~9 jours** de rédaction.

### Étape E — Validation finale (~0.5j)

| Action | Livrable | Coût |
|---|---|---|
| **E.1** Relecture cadrage final | Doc cohérent, deadline atteinte | <0.5j |
| **E.2** Bascule status draft → ready | Modification frontmatter, communication à l'équipe | <0.5j |

---

## §3 Chemin critique

Les actions de l'étape A sont sur le chemin critique : **sans A.1 (bug caractérisés), §1 reformulation ne peut être finalisée**. Sans A.2 (catalogue deferred), §3.7 reste sous-dimensionné. Sans A.3 (scénarios POC), §4.2 (POC projection) ne peut acter ses seuils.

L'étape A peut être parallélisée :
- A.1 par toi (lecture mémoire `pvp-solo-chain-state-hygiene` + `cost-before-overlay-failed` + reconstitution des séquences WS)
- A.2 par toi ou un sous-agent Explore (grep dans `cards.cdb` + ws-protocol pour les patterns courants)
- A.3 par toi (créatif, dépend de ta connaissance du jeu)

**Total chemin critique** : étape A (~3j) + B (~1j) + C (~0.5j) + D (~9j) + E (~0.5j) = **~14 jours-homme**.

Si tu lances le bloc 3 (A.4 optionnel) : +1j mais en parallèle.

---

## §4 Estimation deadline cadrage

Avec une intensité **temps plein** : 3 semaines.
Avec une intensité **mi-temps** (et le reste du backlog skytrix qui tourne) : 5-6 semaines.

La proposition du doc critiques était **2026-06-01** — 7 jours à partir d'aujourd'hui. C'est **trop court** pour 14 j-h de rédaction si tu n'es pas full-time. Recommandation :

- **2026-06-15** (3 semaines, full-time-ish) si tu veux shipper le cadrage avant les 3 semaines.
- **2026-06-30** (5 semaines, mi-temps) si tu mélanges avec le steady-state.

À acter en C.1.

---

## §5 Décisions immédiates à prendre

Avant même de lancer l'étape A, 3 décisions courtes :

1. **Lances-tu le bloc 3 (R3 spike + EC-26 boundaries) ?** (~1j cumulé, parallèle aux étapes A)
   - **Recommandé non** si tu veux avancer ; le doc critiques propose un chemin de mitigation pour les deux (démarrer pipeline sur contrat figé + flat semantics par défaut, stack si besoin avéré).
2. **Quelle deadline acter pour le cadrage ?** (1 ligne dans le doc) → recommandé 2026-06-15.
3. **Veux-tu rédiger l'étape A (A.1 + A.2 + A.3) toi-même ou déléguer une partie à des sous-agents ?**
   - A.1 (bug caractérisation) : difficile à déléguer — demande de jouer la séquence mentalement, mieux par toi.
   - A.2 (catalogue deferred) : déléguable à un sous-agent Explore (grep cards.cdb + ws-protocol).
   - A.3 (POC scénarios) : par toi — créatif et dépendant de ta vision UX.

---

## §6 Livrables attendus à la fin

À la fin de ce plan, tu auras :

- `duel-session-chantier.md` — cadrage complet ready-for-implementation (~700-1000 lignes estimées)
- `bug-solo-sequence.md` + `bug-cost-before-overlay-sequence.md` — tests de victoire reproductibles
- `deferred-effects-catalogue.md` — calibrage §3.7
- `poc-projection-scenarios.md` — gate d'entrée du POC

`duel-session-chantier-critiques.md` (ce travail) reste comme document d'audit historique — peut être archivé après la bascule.
