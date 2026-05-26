---
title: β.3 cas #12 — Commit 1 (DEP refactor) — audit pre-implémentation
status: audit-only (aucun code livré, juste rédaction de spec)
parent_spec: beta-3-case-12-xyz-leave-with-materials-spec.md
related_audits:
  - beta-3-case-12-commit-0bis-AUDIT.md (audit du protocole WS — session parallèle)
date: 2026-05-26
author: Claude (audit) sur branche feat/anim-pipeline-v2
target_commit: 3025bfa1
scope:
  - Refactor `DeferredRule` en union discriminée `ObserverRule | RewriterRule`
  - Ajout `RuleSinks`, `NO_OP_SINKS`, `payload?`, `onClose?`
  - `observe()` retourne `{absorbed: boolean}`
  - Nouveau rule `xyzLeaveWithMaterials`
  - Nouveaux fichiers `ocgcore-reason-flags.ts` + `virtual-event-registry.ts`
out_of_scope:
  - Commit 0bis (protocole WS) — audit séparé
  - Commit 2 (orchestrator + sinks) — pas en jeu ici
  - Phase γ — pas en jeu ici
---

# β.3 cas #12 — Commit 1 — Audit pre-implémentation

## §1 Résumé exécutif du commit 1

Le Commit 1 est un **refactor d'API DEP autonome et mergeable seul** : il
étend le `DeferredEffectProcessor` d'une nouvelle famille de règles —
les `RewriterRule` — capables de (a) synthétiser des events virtuels au
moment du trigger, (b) absorber des events ultérieurs (drop du routing
aval). La famille existante (`ObserverRule`, 5 rules) reste strictement
inchangée à l'exécution. Le typesystem TypeScript discrimine les deux
familles via un champ `kind` ; la garde A1 (test invariant ≤ 1
RewriterRule + commentaire ARCHITECTURE GUARD) verrouille la dérive
"DEP fait tout".

Le commit ajoute le rule `xyzLeaveWithMaterials` qui détecte le pattern
"XYZ avec matériaux quittant le terrain → N settling events
GRAVE→GRAVE reason=0x600", absorbe ces N settling events, et
synthétise N MSG_MOVE virtuels OVERLAY→GRAVE (routés par la branche
existante `processOverlayDetachEvent`).

Deux nouveaux fichiers isolent (a) les constantes OCGCore `REASON_*`
(sourcées de `constant.lua`) du domaine animation, (b) le registre
WeakSet front-only des events virtuels (pas de pollution du protocole
WS).

Les tests unitaires (T-V1 à T-V10) consomment des fixtures synthétiques
portant déjà `overlayMaterials` — Commit 1 est donc **mergeable sans
attendre Commit 0bis** (qui ajoute le champ au protocole). Estimation
spec : 8–12h.

---

## §2 Audit point par point

### §2.0 — §0 Bug visuel à résoudre

**✓ OK** — diagnostic clair, source du bug bien identifiée (routeur
`pileToPile` sur `GRAVE→GRAVE reason=0x600`), causalité OCGCore décrite.
La spec lie au site exact ([move-animation-router.ts:179-180](../../front/src/app/pages/pvp/duel-page/move-animation-router.ts#L179-L180))
ce qui est précieux pour la pass 1.

**Fragile mineur** — la spec affirme que le `reason` settling = `REASON_RULE | REASON_LOST_TARGET = 0x600` mais c'est **non vérifié en
production**. R1 + R8 dans la table risques anticipent ; aucun
re-check ici nécessaire.

### §2.1 — §1 Vue d'ensemble du fix

**✓ OK** — diagrammes de séquence corrects (3 étapes, séquences claires,
WS / orchestrator / DEP / routeur / floats). La table §1.3 « Surface de
modification » est exhaustive.

**Point de clarification (Q1, voir §3 du présent audit)** — la spec
identifie Commit 0bis (protocole) + Commit 1 (DEP) + Commit 2
(orchestrator). Le présent audit confirme la stratégie 3-commits, et
note que Commit 1 ne dépend de **rien** d'autre tant qu'il utilise des
fixtures synthétiques.

### §2.2 — §2 Extension API du DEP

**✓ OK §2.1 (ARCHITECTURE GUARD)** — wording du commentaire est solide,
référence le test invariant explicitement, énonce le seuil Rule of
Three. Voir §5 du présent audit pour le wording exact proposé.

**✓ OK §2.2 (type union)** — la discrimination par `kind?: 'observer' |
'rewriter'` avec `kind?` optionnel sur ObserverRule fonctionne (cf. §3
du présent audit). `RewriterVerdict` couvre 4 cas (rearm / close / absorb
/ absorb-and-close), aucune ambiguïté.

**Fragile §2.3 (RuleSinks)** — l'interface telle que rédigée a un
problème mineur : `lockZone` retourne un `ZoneLock` qui n'est pas un
type exporté visible depuis le DEP aujourd'hui. Cf. §4 du présent
audit pour l'API détaillée.

**Point de clarification §2.4 (Q2)** — le pseudo-code de
`interpretRewriterVerdict(verdict)` est implicite (pas montré). Le
mapping est :
- `null` → `'close'`
- `{kind: 'absorb'}` → `'absorb'`
- `{kind: 'absorb-and-close'}` → `'absorb-and-close'`
- `AwaitingPredicate` (truthy, objet sans `kind`) → `'rearm'`

→ Risque : si un objet `{ kind: 'animation', ... }` (un
`AwaitingPredicate` qui se trouve avoir un champ `kind`) est retourné,
l'aiguillage est ambigu. Le `kind` du `AwaitingPredicate` est libre,
donc collision théorique avec `'absorb'`. La spec doit clarifier que
le verdict est discriminé par `type` du retour (vs présence d'un champ
`kind === 'absorb'`) OU forcer un wrapper `{kind: 'rearm', predicate:
AwaitingPredicate}`.

**✓ OK §2.5 (`observe` retourne `{absorbed}`)** — la signature est
saine. L'invariant "un event peut être absorbed par plusieurs deferreds
simultanément, OR au-dessus suffit" est correctement noté.

**✓ OK §2.6 (`payload?: unknown`)** — opaque, mutable côté rule,
read-only côté DEP. Pattern propre.

**✓ OK §2.7 (compatibilité ascendante)** — l'optionnalité du `kind?:
'observer'` garantit la compat sans migration. Le `NO_OP_SINKS` couvre
le cas où le constructor est appelé sans sinks (tests legacy).

### §2.3 — §3 Wiring orchestrator (hors-scope Commit 1, mais cohérence)

**Hors-scope Commit 1** — le wiring orchestrator est entièrement
Commit 2. Mais la cohérence à vérifier : le `RuleSinks` doit pouvoir
être appelé par le DEP **et** être branché à des no-op par défaut. Le
fait que `NO_OP_SINKS` est défini dans `deferred-effect-processor.ts`
rend le Commit 1 testable sans rien d'autre. ✓ OK.

### §2.4 — §4 Spécification du rule `xyzLeaveWithMaterials`

**Fragile §4.1 (constantes REASON)** — la valeur exacte du mask
settling est documentée comme `REASON_RULE | REASON_LOST_TARGET = 0x600`
mais **non vérifiée en pass 1**. R1 anticipe le cas où la valeur réelle
porte des bits supplémentaires. Suggestion d'enrichir le helper :

```ts
/** Returns true if the candidate reason includes the settling mask,
 *  tolerating extra bits. Use this in the predicate rather than strict
 *  equality, until R1 verifies the exact bit pattern in production. */
export function isXyzMaterialSettleReason(reason: number): boolean {
  return (reason & REASON_XYZ_MATERIAL_SETTLE) === REASON_XYZ_MATERIAL_SETTLE;
}
```

Mais ATTENTION : le matcher du DEP fait du strict-equality (cf.
`DeferredEffectProcessor.matches` lignes 271-278). Une élargissement
masqué ne fonctionnera **pas** via le predicate. Deux options :
1. Stricte égalité sur 0x600 — vérifier en R1 que c'est bien la valeur,
   pas d'élargissement.
2. Étendre le matcher d'un nouveau prédicat de la forme
   `{ reasonMask: number }` qui fait `(candidate.reason & reasonMask) === reasonMask`.
   → Modification non-triviale du matcher. Reportée à
   "à reconsidérer si R1 montre un bug".

→ **Décision Commit 1** : stricte égalité sur `0x600`. Si R1 montre un
écart, étendre dans un patch ultérieur.

**Fragile §4.2 (trigger)** — la fonction `isXyzLeaveWithMaterials`
vérifie `m.fromLocation !== LOCATION.MZONE`. Pas de mention de SZONE.

→ Un XYZ n'est jamais en SZONE (XYZ = Extra Deck monster, va en MZONE
ou EMZ). Donc OK pour le pattern réel.

→ MAIS : la spec dit "MZONE/EMZ" dans §1.1 (et catalogue). Le code
filtre uniquement `MZONE`. Question : `LOCATION.MZONE` inclut-il
implicitement les slots EMZ ? Cf. CLAUDE.md « MR5 EMZ convention » →
"`LOCATION.MZONE` couvre les zones EMZ aussi (EMZ slots sont identifiés
par `sequence ∈ [5,6]`)". → ✓ OK.

**Fragile §4.3 (predicate awaiting)** — manque le champ `player` dans
le predicate :

```ts
{
  type: 'MSG_MOVE',
  fromLocation: LOCATION.GRAVE,
  toLocation: LOCATION.GRAVE,
  reason: REASON_XYZ_MATERIAL_SETTLE,
}
```

→ Risque : un settling event de l'AUTRE joueur (mass destruction
bilatérale, ex Dark Hole sur le board) match aussi. Le `chainTo` filtre
ensuite via `expectedCardCodes.has(m.cardCode)` mais c'est tardif.

→ Suggestion : ajouter `player: m.player` au predicate dérivé. Plus
serré, échappe au cas "settling de l'autre XYZ d'un autre joueur" avant
même de toucher `chainTo`.

**Fragile §4.4 (lock contract)** — le code propose
`sinks.lockZone(xyzZoneKey)` mais :
1. Le format de zone key est `${zoneId}-${relPlayer}` (cf. CLAUDE.md
   « Perspective Convention »). Le pseudo-code utilise
   `locationToZoneKey(LOCATION.MZONE, m.fromSequence, relPlayer)` —
   `relPlayer` est typé `0 | 1` mais le rule reçoit `m.player` qui
   est **absolu**. Conversion manquante : `relPlayer =
   absoluteToRelative(m.player, ownPlayerIndex)`.
2. Le `ownPlayerIndex` n'est pas accessible depuis un rule sans
   passer par un sink supplémentaire OU par le DEP. → Solution :
   le rule reçoit `relPlayer` via le sink (idéalement
   `sinks.relativePlayer(absolute)`) OU lockZone prend un absolute
   et la lookup zone key se fait côté sink.

→ **Décision recommandée** : ajouter une méthode au sink :
`sinks.relativePlayer(absolute: number): 0 | 1` qui délègue à
`ctx.relativePlayer`. Cf. §4 du présent audit pour API étendue.

**Fragile §4.5 (readOverlayMaterialsAtTrigger)** — la spec dit "modif
protocole obligatoire". Commit 1 n'a pas accès à `m.overlayMaterials`
en production tant que Commit 0bis n'est pas mergé. Mais §7.3c note
que les tests de Commit 1 utilisent des fixtures synthétiques. ✓ OK
pour Commit 1 isolément.

→ Question : faut-il que le helper `readOverlayMaterialsAtTrigger`
soit défensif (retourne `[]` si le champ n'est pas là) ? Oui :
`return m.overlayMaterials ?? [];` (déjà dans la spec). En prod
pre-Commit 0bis, le trigger retournera `false` (matCount === 0)
silencieusement, ce qui est le comportement souhaité. ✓ OK.

**✓ OK §4.6 (WeakSet)** — pattern propre, isolé, garbage-collected.
Pas de risque de fuite mémoire. Pas de pollution du protocole.

### §2.5 — §5 Edge cases

**✓ OK 5.1–5.4** — mass destruction, N=1, vide d'overlay, return-to-
deck. Tous bien couverts.

**Fragile 5.5 (XYZ banni)** — la spec note "Number 89 — non couvert en
β.3". OK mais le pattern devrait être robuste : si Number 89 (ou
analogue) émet des `MSG_MOVE GRAVE→BANISHED` au lieu de `GRAVE→GRAVE`,
le predicate ne matchera pas → settling tombe dans `pileToPile` → bug
visuel résiduel. Hors scope Commit 1 mais à noter.

**✓ OK 5.6 (STATE_SYNC/rematch)** — le DEP a `scope:
'CONNECTION_LIFETIME'`, `onClose?` est appelé avec
`reason='checkpoint'`. Lock release garanti.

**Fragile 5.7 (replay seek)** — la spec dit "les deferreds en cours
survivent au switch". MAIS l'orchestrator au switch peut faire
`syncRendered()`/`commitAll()` qui démonte la zone MZONE de l'XYZ
source — le lock externe ne survit pas à un commitAll. **Question pour
Axel (Q3)** : un replay seek déclenche-t-il un `commitAll()` ou juste
un `commitUnlocked()` ? Si `commitAll()`, le lock externe est inutile
post-seek + le rule devrait abandonner via `onClose?` au switch.

**✓ OK 5.8–5.10** — burst cardCode dupliqué, reduced-motion, locks
résolus par D2.

**✓ OK 5.11** — trigger event lui-même settling settled : fallback
sain.

**Edge cases MANQUANTS (§7 du présent audit ci-dessous)** — voir cette
section pour 4 cas non couverts.

### §2.6 — §6 Tests

**✓ OK** — T-V1 à T-V10 couvrent les axes critiques. Mais voir §9 du
présent audit pour des suggestions d'enrichissement (notamment T-V11
absorbed=false par défaut, T-V12 onClose? sur 'matched', T-V13 burst
de 2 deferreds parallèles).

### §2.7 — §7 Plan d'exécution

**✓ OK §7.3a (Commit 0bis)** — autonome, traité dans audit séparé.

**✓ OK §7.3b (Commit 1)** — autonome. Estimation 8–12h crédible (gros
refactor + 10 tests). Voir §8 du présent audit pour ordre détaillé.

**✓ OK §7.3c** — Commit 1 n'attend pas Commit 0bis (fixtures).

### §2.8 — §8 Décisions

**✓ OK 8.1–8.2** — les 5 décisions actées Winston sont cohérentes. Le
log de décisions §12 trace tout.

### §2.9 — §9 Risques

**✓ OK** — R1 à R10 couvrent les axes structurels. Voir §11 du
présent audit pour 3 risques additionnels.

### §2.10 — Questions de clarification à Axel

Numérotées Q1 à Q5 (max 5 imposé par le contrat) :

- **Q1** — Stratégie 3-commits (0bis + 1 + 2) : confirme-t-on que
  Commit 1 peut être mergé avant Commit 0bis ? La spec dit oui via
  fixtures synthétiques mais le test T-V1 vérifie l'**effet**
  (`enqueueVirtualMoves` appelé) ce qui requiert un fixture avec
  `overlayMaterials: [c1, c2]`. Si TS strict mode rejette le champ non
  déclaré dans le type, le test ne compilera pas. → À vérifier en
  pass 1 d'impl.

- **Q2** — Discrimination `RewriterVerdict` : retour `null` =
  close. Retour `{kind: 'absorb'}` = absorb. Mais un
  `AwaitingPredicate` peut LUI AUSSI avoir un champ `kind` (voir
  `deferred-effect.types.ts:38` : `kind?: string`). Donc retourner
  `{ kind: 'animation', type: 'AnimationCompleted', ref: 42 }` (un
  rearm valide) collisionne avec le discriminant `kind: 'absorb'`.
  → Faut-il forcer un wrapper `{ kind: 'rearm', predicate:
  AwaitingPredicate }` pour lever toute ambiguïté ?

- **Q3** — Lock externe + replay seek : si un `resetForSwitch` ou
  `abortAndClean` est déclenché pendant la fenêtre [trigger, last
  settling], le lock externe survit-il à un `commitAll()` ? Si non,
  il faut que le rule abandonne l'instance via le DEP au switch (mais
  le DEP `scope: 'CONNECTION_LIFETIME'` ne reçoit pas le
  `PERSPECTIVE_LIFETIME` du switch — c'est exactement le design
  acté). Conclusion : risque de zone démontée + matériau settling
  manqué. Acceptable ?

- **Q4** — Predicate awaiting : ajouter `player` au prédicat
  (comme suggéré §2.4) ou laisser le `chainTo` filtrer ? Réponse
  pertinente seulement pour mass destruction bilatérale (rare).

- **Q5** — Convention de zone key + relativisation : le rule
  cas #12 doit construire un `xyzZoneKey` en mode relatif (DOM).
  Le sink `lockZone(key)` reçoit donc une key déjà relativisée.
  → Le helper `locationToZoneKey(LOCATION.MZONE, fromSequence,
  relPlayer)` accepte `relPlayer` — qui doit être calculé depuis
  `m.player` (absolu). Soit (a) le sink expose `relativePlayer`,
  soit (b) le sink accepte `player` absolu et fait la conversion
  interne. Préférence ?

---

## §3 Impact backward-compat sur les 5 règles existantes

La spec promet une compatibilité ascendante stricte : "les 5 rules
existants n'ont pas de `kind` explicite → tombent dans `ObserverRule`
(le `kind?: 'observer'` optionnel). Aucune migration nécessaire."

Vérification source-de-vérité ([deferred-effect-rules.ts:97-204](../../front/src/app/pages/pvp/duel-page/deferred-effect-rules.ts#L97-L204)) :

### overlayShow

```ts
const overlayShow: DeferredRule = {
  trigger: e => isChaining(e) && e.chainIndex >= 1,
  deriveName: e => `overlay-show:chain-${(e as ChainingMsg).chainIndex}`,
  derivePredicate: e => ({ type: 'MSG_MOVE', player: ch.player, cardCode: ch.cardCode }),
  chainTo: (matchedEvent, matchedRef, _deferred) => {
    if (!isMove(matchedEvent)) return null;
    return { kind: 'animation', type: 'AnimationCompleted', ref: matchedRef };
  },
};
```

Vérification champ par champ contre `ObserverRule` (cf. §2.2 spec) :
- `trigger: (event: FluxEvent) => boolean` → ✓ signature identique
- `deriveName: (event, ref) => string` → ✓
- `derivePredicate: (event, ref) => AwaitingPredicate` → ✓
- `chainTo?: (matched, matchedRef, deferred) => AwaitingPredicate | null` → ✓

→ **`overlayShow` compile comme `ObserverRule` sans modif.** ✓ Le retour
`{ kind: 'animation', type: 'AnimationCompleted', ref: matchedRef }`
satisfait `AwaitingPredicate` (le champ `kind?: string` existe).

### triggerShow

```ts
const triggerShow: DeferredRule = {
  trigger: e => isMove(e) && e.toLocation === LOCATION.MZONE,
  deriveName: (e, ref) => `trigger-show:${m.cardCode}:${ref}`,
  derivePredicate: (_e, ref) => ({ kind: 'animation', type: 'AnimationCompleted', ref }),
};
```

Pas de `chainTo` → reste optionnel sur ObserverRule. ✓ OK.

### attackImpact

Strictement même shape que `triggerShow` (trigger + deriveName + derivePredicate, pas de chainTo). ✓ OK.

### lpCost

Idem. ✓ OK.

### counterPulse

Idem. ✓ OK.

### Verdict consolidé

**Les 5 rules existants compilent comme `ObserverRule` SANS modification
de leur code.** Compatibilité ascendante stricte préservée.

**Petit ajustement requis côté typage RULES** :

Aujourd'hui ([deferred-effect-rules.ts:236-242](../../front/src/app/pages/pvp/duel-page/deferred-effect-rules.ts#L236-L242)) :

```ts
export const RULES: readonly DeferredRule[] = [
  overlayShow, triggerShow, attackImpact, lpCost, counterPulse,
];
```

Après refactor : `DeferredRule = ObserverRule | RewriterRule`. Le type
`readonly DeferredRule[]` accepte naturellement le mix. ✓ Pas de modif
nécessaire au typage de l'array.

**Petit ajustement requis côté constructeur DEP** ([deferred-effect-processor.ts:161](../../front/src/app/pages/pvp/duel-page/deferred-effect-processor.ts#L161)) :

```ts
constructor(
  private readonly emit: (event: DeferredFluxEvent) => void,
  private readonly getLogger: () => DuelLogger | undefined = () => undefined,
  private readonly clock: DeferredClock = REAL_CLOCK,
  private readonly rules: readonly DeferredRule[] = RULES,
  private readonly sinks: RuleSinks = NO_OP_SINKS, // ← AJOUT Commit 1
) {}
```

→ Default `NO_OP_SINKS` garantit qu'un DEP construit sans sinks (les
tests historiques utilisent une signature 4-args) ne casse pas.

**Petit ajustement requis côté `tryRearm`/`drainMatchingDeferreds`** :
le code actuel ([deferred-effect-processor.ts:318-333](../../front/src/app/pages/pvp/duel-page/deferred-effect-processor.ts#L318-L333))
utilise `deferred.rule.chainTo?.` (chainTo optionnel sur DeferredRule).
Après refactor :
- ObserverRule a `chainTo?` (optionnel)
- RewriterRule a `chainTo` (obligatoire)

Le narrowing par `kind` lève l'ambiguïté :

```ts
if (deferred.rule.kind === 'rewriter') {
  const verdict = deferred.rule.chainTo(event, matchedRef, deferred);
  // verdict est RewriterVerdict
  // interpret + branchement absorb / close / rearm
} else {
  // observer
  const result = deferred.rule.chainTo?.(event, matchedRef, deferred);
  if (result === null || result === undefined) {
    this.closeReady(name, deferred);
  } else {
    this.rearmInPlace(deferred, result);
  }
}
```

→ Pattern propre. Pas de cast forcé.

**Verdict global** : la compat ascendante tient. 0 modif requise sur les
5 fichiers de rule. La seule modif RULES collatérale est le **type du
default sinks dans le constructor** + le **branchement par `kind`** dans
`drainMatchingDeferreds`.

---

## §4 API `RuleSinks` détaillée

Proposition d'interface enrichie suite aux fragilités §2.4 :

```ts
/**
 * Sinks exposés aux RewriterRule au moment de `onTrigger` (ressource
 * acquisition + synthèse d'events) et indirectement via le `payload`
 * porté jusqu'au close (release via `onClose?`).
 *
 * Intentionnellement minimal — chaque méthode est un POINT DE COUPLAGE
 * du DEP avec le reste de l'app. Ajouter une méthode = inviter un
 * nouveau use case ; à faire en revue d'archi, pas opportunément.
 *
 * Le sink par défaut (`NO_OP_SINKS`) fait rien — utilisable comme test
 * seam et en prod tant qu'aucun RewriterRule n'est défini.
 *
 * Cf. décision D2 + Q5 audit Commit 1 (clarification relativPlayer).
 */
export interface RuleSinks {
  /**
   * Enqueue N events virtuels APRÈS l'event courant en cours de
   * dispatch, AVANT les events suivants déjà enqueués mais pas encore
   * dispatchés. Si appelé en dehors d'un dispatch (queue vide),
   * insère en tête de queue.
   *
   * Le DEP appelle ce sink depuis le `onTrigger` d'un RewriterRule.
   * Les events fournis doivent être taggués virtuels via
   * `tagAsVirtual` du `virtual-event-registry` (cf. §4.6 spec
   * cas #12).
   *
   * Pas de garantie d'ordre d'animation : si l'orchestrator a une
   * directive `group` en cours, les virtuels peuvent être absorbés
   * dans le group OU démarrer un nouveau group selon l'implémentation
   * Commit 2.
   */
  enqueueVirtualMoves: (events: readonly MoveMsg[]) => void;

  /**
   * Acquiert un lock ref-compté externe sur la zone identifiée par
   * `zoneKey` (format DOM `${zoneId}-${relPlayer}`).
   *
   * Le rule DOIT release ce lock via le hook `onClose?(payload, reason)`
   * — sur les 3 chemins (matched / timeout / checkpoint). Pattern
   * try/finally encodé par l'API. Sans release, fuite de lock = zone
   * jamais re-committée = bug visuel persistant.
   *
   * Le lock externe est superposable aux locks internes que les
   * handlers acquièrent eux-mêmes — c'est du ref-counting, donc
   * indépendant. La zone reste rendered DOM tant que l'un OU
   * l'autre est actif.
   */
  lockZone: (zoneKey: string) => ZoneLock;

  /**
   * Convertit un index joueur absolu (server convention, 0|1) en index
   * relatif (perspective viewer, 0=me, 1=opponent). Délègue à
   * `ctx.relativePlayer` côté orchestrator.
   *
   * Pourquoi ce sink existe — un rule qui construit une zone key
   * (`${zoneId}-${relPlayer}`) part toujours d'un index absolu (lu
   * sur un event WS). La conversion en relatif requiert
   * `ownPlayerIndex` (ou `perspectiveIndex` en replay), qui est un
   * concern de l'orchestrator/contexte. Sans ce sink, le rule devrait
   * soit dupliquer la lookup (couplage caché), soit recevoir un sink
   * supplémentaire `getOwnPlayerIndex` (encore plus de fuite).
   *
   * Question Q5 audit Commit 1 : à confirmer avec Axel — l'autre
   * option est de faire signer `lockZone(zoneId, absolutePlayer)`
   * et de faire la conversion dans le sink. Choix actuel (passer une
   * key pré-relativisée) est plus orthogonal mais oblige le rule à
   * connaître la convention.
   */
  relativePlayer: (absolute: number) => 0 | 1;
}

/** Sentinel pour les zones lockables. La méthode `release()` peut être
 *  appelée plusieurs fois sans erreur (idempotent) — Aide pour les
 *  branches `onClose?` qui peuvent être appelées sur plusieurs chemins
 *  fermant la même deferred (matched + checkpoint en cascade dans un
 *  burst). */
export interface ZoneLock {
  release: () => void;
}

export const NO_OP_SINKS: RuleSinks = {
  enqueueVirtualMoves: () => { /* wired by orchestrator in prod */ },
  lockZone: () => ({ release: () => { /* no-op */ } } as ZoneLock),
  relativePlayer: (absolute) => (absolute === 0 ? 0 : 1),
};
```

### Justification membre par membre

- **`enqueueVirtualMoves`** — coeur de la famille "rewrite". Sans ça,
  pas de synthèse possible. Nécessaire.
- **`lockZone`** — nécessaire pour le contrat lock du cas #12 (cf.
  D2). Sans ça, fuite de zone démontée → bug visuel.
- **`relativePlayer`** — nécessaire pour construire des zone keys DOM
  depuis un `m.player` absolu. Alternative refusée (passer
  `absolute` à `lockZone`) pour garder le sink agnostique de la
  convention de naming.
- **`ZoneLock.release`** — sentinel minimal. `idempotent` est
  documenté pour permettre des chemins doubles (matched +
  checkpoint cascade, etc.).

### Anti-features (volontairement exclues)

- ❌ `pushAnimationEvent` — explicitement listé dans le prompt audit
  comme membre potentiel. **Refusé** : le DEP n'a pas à pousser des
  events d'animation directement ; c'est l'orchestrator qui le fait
  via `pushAnimationStarted` / `pushAnimationCompleted` après lecture
  du side-channel `_transport_lastAbsorbed`. Mélanger les
  responsabilités ouvrirait la porte à des rules qui synthétisent des
  AnimationStarted hors contexte. **Pattern à conserver**.
- ❌ `getLogicalState` / `peekRenderedState` — pas nécessaire pour
  cas #12 (le rule lit `m.overlayMaterials` du trigger event,
  self-contained). Ajouter ouvrirait le DEP à des décisions stateful
  arbitraires.
- ❌ `commitZone` / `releaseLock` standalone — release est lié au
  hook `onClose?`. Pas de release manuel.

→ Le sink reste à **3 méthodes**. Toute extension future déclenche
revue d'archi (parallèle de la garde RewriterRule).

---

## §5 Garde architecturale "Rule of Three"

### Wording exact du commentaire ARCHITECTURE GUARD

À placer en commentaire JSDoc **au-dessus** de `interface RewriterRule`
dans `deferred-effect-processor.ts` :

```ts
/**
 * ⚠️ ARCHITECTURE GUARD (β.3 cas #12, 2026-05-26)
 *
 * `RewriterRule` est la famille "Flow rewrite" (catalogue ε3 §1bis).
 * Elle ROMPT l'invariant pure-observer du DEP : elle synthétise des
 * events virtuels via `onTrigger` (side-effect sortant) et absorbe
 * des events ultérieurs via `chainTo` retournant `{kind: 'absorb'}` /
 * `{kind: 'absorb-and-close'}` (side-effect entrant — drop du
 * routing aval).
 *
 * Aujourd'hui UN SEUL RewriterRule existe : `xyzLeaveWithMaterials`.
 *
 * AVANT D'AJOUTER UN 2e RewriterRule — REVUE D'ARCHI OBLIGATOIRE.
 * Rule of Three : à 2 cas du même genre, extraire un processor
 * séparé `FlowRewriteProcessor` est probablement la meilleure
 * réponse, plutôt que d'élargir la famille rewriter dans le DEP.
 *
 * Le test invariant `deferred-effect-rules.spec.ts`
 *   "β.3 cas #12 — at most one RewriterRule allowed without architecture review"
 * verrouille cette garde au build CI (compile-test time).
 *
 * Cf. décisions A1 + B2 architecture review β.3 cas #12.
 * Cf. spec d'impl §2.1 + §10 hors-scope.
 */
export interface RewriterRule extends BaseRule {
  kind: 'rewriter';
  // ...
}
```

### Code exact du test T-V9

À placer dans `deferred-effect-rules.spec.ts` (fichier existant
probablement à créer pour héberger ce test + d'autres asserts sur la
table) :

```ts
import { RULES } from './deferred-effect-rules';

describe('β.3 cas #12 — architecture guard A1', () => {
  it('at most one RewriterRule allowed without architecture review', () => {
    const rewriters = RULES.filter(r => r.kind === 'rewriter');
    expect(rewriters.length).toBeLessThanOrEqual(1);

    if (rewriters.length === 1) {
      // Phase actuelle (β.3) — un seul cas rewriter attendu.
      // Si ce test échoue avec rewriters.length > 1, c'est qu'un 2e
      // RewriterRule a été ajouté sans revue d'archi.
      // → ARRÊT IMMÉDIAT : ouvrir un mémo "Rule of Three triggered"
      //   et décider si on extrait un FlowRewriteProcessor séparé.
      // Cf. ARCHITECTURE GUARD au-dessus de RewriterRule.
      expect(rewriters[0].kind).toBe('rewriter');
    }
  });

  it('exactly one RewriterRule shipped at β.3 cas #12', () => {
    // Test concret de l'état attendu — change quand on en ajoute un
    // (et déclenche la revue d'archi via le test précédent).
    const rewriterNames = RULES
      .filter(r => r.kind === 'rewriter')
      .map(r => r.deriveName({} as never, 0));
    expect(rewriterNames).toEqual(jasmine.arrayContaining([
      jasmine.stringMatching(/^xyz-leave:/),
    ]));
  });
});
```

→ Le 2e test (`exactly one`) est complémentaire — il s'assure que la
famille n'a pas été supprimée par mégarde. Si on retire
`xyzLeaveWithMaterials`, ce test échoue (intentionnel — révèle un
revert silencieux).

---

## §6 Détection du pattern `xyzLeaveWithMaterials`

Prédicat exact pour le trigger, avec gestion des 4 axes demandés :

```ts
import { LOCATION } from '../duel-ws.types';
import type { MoveMsg } from '../duel-ws.types';
import type { StreamEvent } from '../types';

/** Type guard : un FluxEvent est un MSG_MOVE. */
function isMove(e: StreamEvent): e is MoveMsg {
  return (e as { type?: string }).type === 'MSG_MOVE';
}

/**
 * β.3 cas #12 — détection du pattern "XYZ avec matériaux quittant le
 * terrain". Le pattern absorbe TOUTES les raisons de départ :
 *   - REASON_DESTROY (Dark Hole, Lightning Storm, battle destroy
 *     via REASON_BATTLE additionnel, etc.)
 *   - REASON_RELEASE (Tribute Summon, Tribute pour cost d'effect)
 *   - REASON_LINK (matériel de Link summon)
 *   - REASON_SYNCHRO / REASON_FUSION / REASON_RITUAL / REASON_XYZ
 *     (matériel d'un autre summon Extra)
 *   - REASON_REDIRECT (Compulsory Evacuation Device — return to hand)
 *   - REASON_RULE (banishment / mill OCG-internal rule)
 *   - REASON_EFFECT (mass effects bouncing XYZ)
 *
 * → Le trigger NE LIT PAS la `reason` du MSG_MOVE de l'XYZ. La
 * détection est "est-ce un XYZ qui part du terrain avec des
 * matériaux". La raison n'entre pas dans le filtre — sinon il
 * faudrait maintenir une liste exhaustive et exotique.
 *
 * Trigger booléen pur — aucune knowledge sur la destination (le XYZ
 * peut aller en GRAVE, BANISHED, EXTRA, HAND, etc.).
 */
function isXyzLeaveWithMaterials(e: StreamEvent): e is MoveMsg {
  if (!isMove(e)) return false;
  const m = e;  // narrowed by type guard

  // (a) Source = field (MZONE inclut EMZ via convention OCGCore
  //     `sequence ∈ [5,6]` — cf. CLAUDE.md « MR5 EMZ convention »).
  if (m.fromLocation !== LOCATION.MZONE) return false;

  // (b) Le champ overlayMaterials est porté par le MoveMsg (Commit 0bis
  //     du protocole). Helper défensif : retourne [] si absent.
  const materials = readOverlayMaterialsAtTrigger(m);

  // (c) Filtre matCount > 0 — sinon le pattern ne s'applique pas (XYZ
  //     déjà détaché de ses matériaux, ou Effect Monster qui n'en a
  //     jamais eu).
  if (materials.length === 0) return false;

  // (d) Destination arbitraire — pas de filtre.
  //     Toutes raisons de départ couvertes — pas de filtre sur m.reason.
  return true;
}

/** Helper défensif. Retourne `[]` si `m.overlayMaterials` est absent
 *  (cas pré-Commit 0bis, ou MSG_MOVE non-XYZ). En live PvP post-Commit
 *  0bis, retourne le snapshot des matériaux capturé par
 *  `transformMove` via `OcgQueryFlags.OVERLAY` AVANT mutation
 *  OCGCore. */
function readOverlayMaterialsAtTrigger(m: MoveMsg): readonly number[] {
  return m.overlayMaterials ?? [];
}
```

### Notes sur chaque axe demandé

**(a) MSG_MOVE depuis MZONE/EMZ_L/EMZ_R** — couvert via
`LOCATION.MZONE` seul. La convention OCGCore (cf. CLAUDE.md MR5)
définit EMZ comme `sequence ∈ [5,6]` dans MZONE. Pas de `LOCATION.EMZ`
distinct.

**(b) Lecture `msg.overlayMaterials` (champ 0bis)** — via helper
`readOverlayMaterialsAtTrigger`. Défensif sur `?? []` pour permettre
Commit 1 mergeable avant Commit 0bis. Le helper est testable
indépendamment.

**(c) Filtre `length > 0`** — couvert ligne `if (materials.length ===
0) return false;`.

**(d) Toutes raisons de départ** — explicitement **pas filtré**.
Justification : le filtre par raison serait fragile (REASON_* est un
bitfield ; nouvelles raisons OCG-internes peuvent émerger). La
détection robuste = "XYZ qui part du terrain", peu importe pourquoi.

### Robustesse face aux faux positifs

Le filtre `materials.length > 0` est l'invariant clé. Conditions
nécessaires & suffisantes pour fire :
1. `type === 'MSG_MOVE'` ✓
2. `fromLocation === MZONE` ✓
3. `overlayMaterials.length > 0` ✓ (seul un XYZ peut avoir ce champ
   non-vide après Commit 0bis)

→ **Faux positif théorique** : un Pendulum monstre en MZONE qui
quitte avec des « Pendulum scales » comptés comme overlayMaterials.
Vérifier en pass 1 que la query `OcgQueryFlags.OVERLAY` ne retourne
QUE les XYZ overlayCards. Sinon, durcir le filtre via
`m.cardCode` lookup (type === XYZ Monster dans la cards.cdb).

**Hors scope Commit 1** : durcissement par card-type. Si Commit 0bis
montre des faux positifs en pass 1, déclencher un Commit 1bis.

---

## §7 Edge cases supplémentaires non couverts par la spec

La spec couvre 5.1–5.11. Les cas suivants ne sont **pas** explicitement
traités :

### EC-A — XYZ qui re-rentre en EXTRA via un effet de bounce (vs destroy)

**Scénario** : Compulsory Evacuation Device ciblant un XYZ adverse →
XYZ retourne à la main de son owner. Matériaux vont au GY (règle YGO).

**Couverture spec actuelle** : §5.4 traite "Return-to-deck" (EXTRA
deck) mais pas le bounce vers HAND.

**Risque** : `MSG_MOVE` de l'XYZ vers `LOCATION.HAND`. Le routeur
existant a une branche `MZONE→HAND` (bounce) qui fait `travelToHand`.
Les matériaux settling sont quand même émis (règle YGO universelle :
matériaux d'un XYZ qui part vont au GY).

**Verdict** : ✓ Le rule cas #12 traite ça correctement (trigger fire
sur le MSG_MOVE de l'XYZ peu importe destination ; predicate awaiting
absorbe les settling GRAVE→GRAVE). Pas de modif requise. Mais **ajouter
un test T-I6 explicite** pour bounce vers HAND.

### EC-B — XYZ avec 1 seul matériau

**Couverture spec actuelle** : §5.2 traite explicitement. ✓ OK.

### EC-C — XYZ avec >5 matériaux (Numbers extrêmes)

**Scénario** : Number 100: Numeron Dragon (peut accumuler >5
matériaux via effets). Mass destruction → 6+ settling events.

**Couverture spec actuelle** : §R7 "Mass destruction de 3+ XYZ avec
des matériaux qui se croisent" mais pas un cas mono-XYZ avec N>5.

**Risque** : aucun technique. Le `expectedCardCodes: Set<number>` est
unbounded. Le `remaining: number` aussi. La queue d'animation absorbe
N events virtuels sans plafond.

**Mais** : performance. 6 floats simultanés depuis la même MZONE vers
le GY, en parallèle, peut surcharger le compositor. → Recommandation :
animer en **stagger** (cf. spec §10 hors-scope "animation parallèle vs
stagger"). Mais c'est Commit 2 (orchestrator) qui décide. Pas un blocker
Commit 1.

**Verdict** : ✓ Robuste, mais documenter "N>5 stagger recommandé" dans
le Commit 2.

### EC-D — Mass destruction où 2 XYZ partagent une carte (Materialiser)

**Scénario** : Materialiser (anti-pattern OCG) ou un bug OCGCore où
deux XYZ comptent un même `cardCode` dans leurs overlayMaterials.
Mass destruction → 1 settling event avec ce cardCode est émis (ou 2,
selon comment OCGCore résout).

**Couverture spec actuelle** : §5.1 "Cas pathologique" — partial.

**Risque** : si OCGCore émet 1 seul settling pour les 2 XYZ qui
partageaient le matériau, le premier deferred l'absorbe + décrémente.
Le second deferred attend en vain → timeout après 5s → warn dans
console.

**Mitigation actuelle** : `chainTo` rearm avec même predicate sur
cardCode hors liste (cf. §4.4.3). Mais une fois le cardCode consommé
par le premier deferred, le second voit son `expectedCardCodes`
contenir un cardCode qui n'arrivera jamais. Timeout 5s, warn, pas de
crash. ✓ Acceptable.

→ **Recommandation** : ajouter test T-V14 "two deferreds expecting
the same cardCode, one absorbs first → second times out cleanly".

### EC-E — Switch perspective replay au milieu d'un absorbing

**Scénario** : utilisateur clique le bouton "switch perspective" en
replay PENDANT que le rule cas #12 est ouvert (a vu le trigger MSG_MOVE
XYZ mais pas tous les settlings).

**Couverture spec actuelle** : §5.7 dit "les deferreds en cours
survivent au switch (PERSPECTIVE_LIFETIME plus volatile que
CONNECTION_LIFETIME)".

**Risque non couvert** : le **lock externe** acquis par `onTrigger`
sur la zone MZONE relative au joueur de la perspective AVANT switch
est désynchronisé après switch. Si le perspective change, la zone key
`MZONE-0` (anciennement le joueur viewer) devient `MZONE-1`
(maintenant l'adversaire).

→ Le lock acquis sur `MZONE-0` reste en vie mais ne protège plus la
bonne zone DOM. Bug visuel possible : la zone démontée n'est pas la
même que la zone lockée.

**Mitigation requise** : sur switch perspective, soit (a) le DEP
abandonne les RewriterRule deferreds (rule onClose? reçoit
`reason='checkpoint'`), soit (b) le `payload.xyzZoneLock` est
**recomputed** lors du switch.

→ **Question pour Axel (Q3 du présent audit)** : préférence ?

→ Hors scope Commit 1 (le wiring lock est Commit 2). Mais à
**documenter dans la spec Commit 2** comme un edge case Commit 2
doit résoudre.

---

## §8 Plan d'implémentation détaillé

Ordre exact des éditions de fichier pour Commit 1 :

### Étape 1 — Création de `ocgcore-reason-flags.ts` (fichier autonome)

`front/src/app/pages/pvp/duel-page/ocgcore-reason-flags.ts` :

```ts
// =============================================================================
// ocgcore-reason-flags.ts — β.3 cas #12 (2026-05-26)
// -----------------------------------------------------------------------------
// OCGCore reason bitfield constants. Source de vérité authoritative :
// duel-server/data/scripts_full/constant.lua:125-152.
//
// Isolé du fichier animation-constants.ts à dessein — la knowledge YGO
// (REASON_*) n'a rien à voir avec les durations d'animation. Cf.
// décision D2 architecture review β.3 cas #12.
//
// ⚠️ Le wasm @n1xx1/ocgcore-wasm émet ces valeurs telles quelles sur
// la query `OcgQueryFlags.REASON`. Ne PAS confondre avec les
// constantes (fausses) déclarées dans game-log-builder.ts et
// replay-precompute.ts — bug pré-existant orthogonal, signalé dans
// R9 spec cas #12.
// =============================================================================

export const REASON_DESTROY     = 0x1;
export const REASON_RELEASE     = 0x2;
// ... (toute la liste de §4.1 spec, copiée)

/** Cas #12 — exactement le mask émis par OCGCore pour le settling
 *  position des ex-matériaux d'XYZ une fois l'XYZ parti. */
export const REASON_XYZ_MATERIAL_SETTLE = REASON_RULE | REASON_LOST_TARGET; // 0x600
```

**Pas de test dédié** — constantes pures. Couvert indirectement par les
tests de cas #12.

### Étape 2 — Création de `virtual-event-registry.ts` (fichier autonome)

`front/src/app/pages/pvp/duel-page/virtual-event-registry.ts` :

```ts
// (cf. §4.6 spec — code complet, ~15 lignes)
const VIRTUAL_EVENTS = new WeakSet<object>();
export function tagAsVirtual<T extends object>(event: T): T { ... }
export function isVirtual(event: object): boolean { ... }
```

**Test unitaire associé** :
`virtual-event-registry.spec.ts` (2 tests : tag-then-detect, no-tag-detect-false).

### Étape 3 — Refactor `deferred-effect-processor.ts`

Éditions séquentielles dans le fichier (ordre conseillé pour TS
satisfaction continue) :

3.1. Ajouter le commentaire `ARCHITECTURE GUARD` au-dessus de l'endroit
où va arriver `RewriterRule`.

3.2. Introduire l'interface `BaseRule extends` pas encore présente
(`trigger`, `deriveName`, `derivePredicate`).

3.3. Refactor `interface DeferredRule` → split en :
- `interface ObserverRule extends BaseRule` (avec `kind?: 'observer'`
  + `chainTo?` optionnel).
- `interface RewriterRule extends BaseRule` (avec `kind: 'rewriter'`
  + `onTrigger`, `onClose?`, `chainTo` obligatoire).

3.4. Définir `type RewriterVerdict = AwaitingPredicate | null | { kind:
'absorb' } | { kind: 'absorb-and-close' }`.

3.5. Définir `type DeferredRule = ObserverRule | RewriterRule`.

3.6. Définir `interface RuleSinks` (cf. §4 du présent audit) +
`interface ZoneLock` + `export const NO_OP_SINKS`.

3.7. Ajouter `payload?: unknown` à `interface ActiveDeferredView` et
`interface ActiveDeferred`.

3.8. Modifier constructor pour accepter `sinks: RuleSinks =
NO_OP_SINKS`.

3.9. Modifier `observe(event, ref)` pour retourner `{absorbed:
boolean}` au lieu de `void`.

3.10. Refactor `drainMatchingDeferreds` : branche `if (deferred.rule.kind
=== 'rewriter')` qui appelle le nouveau `chainTo` retournant un
`RewriterVerdict`, branchement sur les 4 cas (rearm / close / absorb
/ absorb-and-close). La branche `else` garde le code legacy (observer
chainTo).

3.11. Refactor `openDeferred` : branche `if (rule.kind === 'rewriter')`
qui appelle `rule.onTrigger(event, ref, this.sinks)` et stocke le
`payload` retourné dans l'`ActiveDeferred`.

3.12. Ajouter helper privé `interpretRewriterVerdict(verdict):
{kind: 'rearm', predicate} | {kind: 'close'} | {kind: 'absorb'} |
{kind: 'absorb-and-close'}`. Gère la discrimination Q2 (audit) avec
attention au cas `AwaitingPredicate` contenant un `kind`.

3.13. Refactor `closeReady` + `abandonByName` pour appeler
`rule.onClose?.(payload, reason)` AVANT l'emit. Définir `type
CloseReason = 'matched' | 'timeout' | 'checkpoint'`.

3.14. Vérifier que `silentReset` ne touche **pas** à `onClose?`
(intentionnel — silentReset signifie "stream subscriber dies with
the same scope, emitting closures pollutes a stream nobody reads").

### Étape 4 — Modifier `deferred-effect-rules.ts`

4.1. Ajouter helpers `isXyzLeaveWithMaterials` + `readOverlayMaterialsAtTrigger`
(cf. §6 du présent audit).

4.2. Définir `interface XyzLeavePayload` (cf. §4.4.2 spec).

4.3. Définir `const xyzLeaveWithMaterials: RewriterRule = { ... }`
(cf. §4.4.2 spec).

4.4. Ajouter à `export const RULES: readonly DeferredRule[] = [...]`
(en dernière position pour clarté de lecture).

### Étape 5 — Tests `deferred-effect-processor.spec.ts`

Ajouter T-V1 à T-V8 (T-V9 et T-V10 vivent dans
`deferred-effect-rules.spec.ts`).

Note critique : les fixtures synthétiques doivent porter
`overlayMaterials: [c1, c2]` comme un **cast** parce que le champ
n'existe pas encore dans `MoveMsg` (Commit 0bis pas mergé).
Recommandation :

```ts
function msgMoveXyzLeave(materials: number[]): StreamEvent {
  return {
    type: 'MSG_MOVE',
    fromLocation: LOCATION.MZONE,
    toLocation: LOCATION.GRAVE,
    fromSequence: 0,
    player: 0,
    overlayMaterials: materials,  // ← cast nécessaire si type pas mergé
    /* champs obligatoires de MoveMsg dummy */
  } as unknown as StreamEvent;
}
```

### Étape 6 — Tests `deferred-effect-rules.spec.ts`

Créer le fichier (n'existe pas aujourd'hui — vérifier au pass 1).
Ajouter T-V9 + T-V10 + EC-D test (T-V14) (cf. §9 + §7 du présent audit).

### Étape 7 — Régression suite complète

Lancer `npm run test --watch=false` (1518 specs attendus verts). Tout
test concernant les 5 ObserverRule doit rester vert sans modification.

### Estimation détaillée

| Étape | Heures |
|---|---|
| 1 — ocgcore-reason-flags.ts | 0.5h |
| 2 — virtual-event-registry.ts + spec | 1h |
| 3 — refactor DEP (12 sous-étapes) | 4-6h |
| 4 — rule xyzLeaveWithMaterials | 1.5h |
| 5 — tests T-V1 à T-V8 | 2h |
| 6 — tests T-V9 + T-V10 + T-V14 | 1h |
| 7 — régression + debug | 1h |
| **Total** | **11-13h** |

→ Concorde avec l'estimation spec **8–12h** (la borne haute couvre le
debug régression).

---

## §9 Plan de tests T-V1 à T-V10 (+ extensions audit)

### Tests issus de la spec

**T-V1** — `onTrigger` est appelé avec le bon ref
- **Intention** : le rule's `onTrigger` reçoit `(event, ref, sinks)`
  avec les valeurs attendues, et appelle `sinks.enqueueVirtualMoves`
  avec un array de la bonne taille.
- **Fixture** : MoveMsg synthétique XYZ avec `overlayMaterials: [c1, c2]`,
  observe avec `ref=42`.
- **Assert** : `sinks.enqueueVirtualMoves` called with array of length 2.

**T-V2** — `chainTo` `absorb` maintient la deferred ouverte
- **Intention** : un settling event matchant le predicate avec
  cardCode in expectedCardCodes ne ferme pas la deferred si N>1
  matériaux restants.
- **Fixture** : trigger 2 matériaux, observe 1 settling.
- **Assert** : `activeCount === 1`, pas d'`EffectReady` emit.

**T-V3** — `chainTo` `absorb-and-close` ferme + emit EffectReady
- **Intention** : le dernier settling event ferme la deferred et
  émet `EffectReady`.
- **Fixture** : trigger 2 matériaux, observe 2 settlings.
- **Assert** : `activeCount === 0`, EffectReady avec `name: 'xyz-leave:42'`.

**T-V4** — `observe` retourne `{absorbed: true}` pour un settling
- **Intention** : le flag est exposé correctement.
- **Fixture** : trigger + 1 settling.
- **Assert** : `observe(settling).absorbed === true`.

**T-V5** — Timeout normal sur la deferred si les settlings n'arrivent pas
- **Intention** : le timer 5s fait son job sans settlings.
- **Fixture** : trigger seul, advance clock DEFERRED_TIMEOUT_MS+1.
- **Assert** : EffectAbandoned `reason: 'timeout'`.

**T-V6** — Compat ascendante : les 5 rules existants ne sont pas affectés
- **Intention** : `kind !== 'rewriter'` chez les 5 existants.
- **Fixture** : statique sur `RULES`.
- **Assert** : chaque rule (non-rewriter) n'a pas de `onTrigger` ni `onClose`.

**T-V7** — Cleanup `onClose?` sur `'timeout'`
- **Intention** : le release du payload (lock) se déclenche bien
  à timeout.
- **Fixture** : trigger, advance clock, vérifier onClose appelé avec
  `reason: 'timeout'`.

**T-V8** — Cleanup `onClose?` sur `'checkpoint'`
- **Intention** : applyReset(CONNECTION_LIFETIME) déclenche onClose
  pour chaque deferred ouverte.
- **Fixture** : trigger, applyReset, vérifier onClose appelé avec
  `reason: 'checkpoint'`.

**T-V9** — Garde architecturale A1 : au plus 1 RewriterRule
- **Intention** : empêcher la dérive silencieuse.
- **Fixture** : `RULES.filter(r => r.kind === 'rewriter').length`.
- **Assert** : `<= 1`.

**T-V10** — Gating compile-time du type union B2
- **Intention** : vérifier (humain code review) que les contraintes TS
  empêchent `ObserverRule` avec `onTrigger`, ou `RewriterRule` sans
  `onTrigger`.
- **Fixture** : pas un test runtime — une assertion sur les types
  via `// @ts-expect-error` dans des tests `*.ts-check`.
- **Note** : ce test peut être un fichier `.ts-only` parsé par tsc
  en mode `noEmit + strict`.

### Tests ajoutés par cet audit

**T-V11** — `observe` retourne `{absorbed: false}` quand aucun
  RewriterRule ne match
- **Intention** : la valeur par défaut est `false`, ne pas
  accidentellement leak un `true` orphelin.
- **Fixture** : observe avec un event qui matche zéro rule.
- **Assert** : `observe(event).absorbed === false`.

**T-V12** — Cleanup `onClose?` sur `'matched'` (chemin happy)
- **Intention** : le hook fire aussi sur fermeture normale (`absorb-
  and-close`).
- **Fixture** : trigger + N settlings (jusqu'à close), vérifier
  onClose appelé avec `reason: 'matched'`.

**T-V13** — Deux deferreds parallèles (2 XYZ partent en même temps)
- **Intention** : la corrélation cardCode-based fonctionne.
- **Fixture** : trigger XYZ1 avec mats [c1,c2], trigger XYZ2 avec
  mats [c3,c4], observe les 4 settlings.
- **Assert** : 2 EffectReady emis dans le bon ordre, locks release.

**T-V14** — Deux deferreds avec cardCode partagé (EC-D)
- **Intention** : robustesse au cas pathologique.
- **Fixture** : trigger XYZ1 + XYZ2 avec cardCode commun c1, observe
  1 settling c1.
- **Assert** : un deferred close, l'autre timeout proprement (warn +
  EffectAbandoned).

**T-V15** — Verdict ambigu Q2 (`{kind: 'animation', ...}` qui est un
  AwaitingPredicate avec champ kind)
- **Intention** : la discrimination interpretRewriterVerdict est
  univoque même quand `AwaitingPredicate.kind` est défini.
- **Fixture** : rule avec `chainTo` retournant
  `{kind: 'animation', type: 'AnimationCompleted', ref: 42}`.
- **Assert** : le verdict est interprété comme `rearm`, pas comme
  `absorb`.

---

## §10 Plan de tests d'intégration (T-I1 à T-I5) — référence

Hors-scope Commit 1 (vont avec Commit 2). Listés pour cohérence :

- **T-I1** — DUAL assertion (cf. spec §6.2) : pas de pileToPile +
  overlay floats animés.
- **T-I2** — Lock contract maintenu pendant les virtuels.
- **T-I3** — Battle destroy variant.
- **T-I4** — Return-to-deck variant.
- **T-I5** — Banished variant.

### Tests d'intégration ajoutés par cet audit

- **T-I6** — Bounce vers HAND (EC-A) : XYZ retournant à la main de son
  owner via Compulsory Evacuation Device.
- **T-I7** — Mass destruction bilatérale (EC-A bis) : Dark Hole
  détruit 1 XYZ par joueur, 4 settlings total, corrélation par
  player+cardCode.

---

## §11 Risques additionnels et mitigations

La spec liste R1 à R10. Voici 3 risques additionnels identifiés par
l'audit :

### R11 — Discrimination ambiguë du verdict (Q2)

Le `RewriterVerdict` peut être :
- `null` → close
- `{kind: 'absorb'}` → absorb
- `{kind: 'absorb-and-close'}` → absorb-and-close
- `AwaitingPredicate` → rearm

MAIS un `AwaitingPredicate` peut LUI AUSSI avoir un champ `kind`
(`AwaitingPredicate.kind?: string` — cf. types/deferred-effect.types.ts:38).

→ Un retour `{ kind: 'animation', type: 'AnimationCompleted', ref: 42 }`
est valide pour les 2 cas (rearm OU absorb si on lit naïvement).

**Mitigation proposée** :
1. Option A : forcer un wrapper explicite `{kind: 'rearm', predicate:
   AwaitingPredicate}`. Plus verbeux mais sans ambiguïté.
2. Option B : tester `verdict.kind === 'absorb' || verdict.kind ===
   'absorb-and-close'` AVANT de tester si c'est un AwaitingPredicate.
   La discrimination est sur les VALEURS spécifiques `'absorb'` et
   `'absorb-and-close'`, pas sur la présence d'un champ `kind`.
3. Option C : utiliser un type symbole (`Symbol.for('absorb')`) plutôt
   qu'une chaîne. Robuste mais lourd.

**Recommandation** : Option B (test sur valeurs spécifiques). Simple,
pas de breaking change.

### R12 — Lock externe vs replay seek (EC-E)

Cf. §7 audit, EC-E.

**Mitigation Commit 1** : aucune (Commit 1 ne touche pas aux locks
réels — c'est `NO_OP_SINKS.lockZone` qui retourne un release no-op
dans les tests).

**Mitigation Commit 2** : documenter dans spec Commit 2 que le `replay
seek` doit invalider les RewriterRule deferreds OU recomputer les
locks.

### R13 — Faux positif Pendulum (filtre overlayMaterials.length > 0)

Si la query `OcgQueryFlags.OVERLAY` côté serveur (Commit 0bis) retourne
les **Pendulum scales** quand un Pendulum monstre quitte le terrain
(spéculatif — à vérifier en pass 1), le trigger fire à tort sur des
Pendulum monstres.

**Mitigation** : test pass 1 avec un Pendulum monstre qui part.

**Mitigation Commit 1** : aucune (lecture du champ via helper, OK).

**Mitigation Commit 0bis** : la query `OcgQueryFlags.OVERLAY` ne
devrait retourner que des XYZ overlayCards. À vérifier dans la pass
1 d'impl Commit 0bis (audit séparé). Si bug confirmé, Commit 0bis
filtre côté serveur ou Commit 1 ajoute un filter cardCode.cardType
=== TYPE_XYZ_MONSTER.

---

## §12 Décisions ratifiées par cet audit

| # | Sujet | Décision |
|---|-------|----------|
| 1 | Stratégie 3-commits | ✓ Confirmée. Commit 1 mergeable seul via fixtures synthétiques. |
| 2 | RuleSinks à 3 méthodes (vs 2) | ✓ Ajout `relativePlayer` proposé (Q5). |
| 3 | Discrimination RewriterVerdict | ✓ Option B (test sur valeurs spécifiques `'absorb'` / `'absorb-and-close'` AVANT typage AwaitingPredicate). |
| 4 | Predicate awaiting avec `player` | ✓ Recommandé d'ajouter `player: m.player` au predicate dérivé (audit §2.4). |
| 5 | Tests ajoutés | ✓ T-V11 à T-V15 + T-I6, T-I7. |
| 6 | Faux positif Pendulum | ⏳ En pass 1 d'impl Commit 0bis à vérifier. |
| 7 | EC-E (replay seek) | ⏳ Documenter dans spec Commit 2. |

---

## §13 Sources

- Spec parent : `beta-3-case-12-xyz-leave-with-materials-spec.md`
  (commit untracked, 1615 lignes).
- Catalogue : `deferred-effects-catalogue.md` §1bis (cas #12).
- Code source DEP : [deferred-effect-processor.ts](../../front/src/app/pages/pvp/duel-page/deferred-effect-processor.ts)
  (371 lignes, β.2a).
- Code source rules : [deferred-effect-rules.ts](../../front/src/app/pages/pvp/duel-page/deferred-effect-rules.ts)
  (242 lignes, β.2b — 5 rules).
- Code source spec actuel : [deferred-effect-processor.spec.ts](../../front/src/app/pages/pvp/duel-page/deferred-effect-processor.spec.ts)
  (suite existante, à étendre).
- Types : [types/deferred-effect.types.ts](../../front/src/app/pages/pvp/types/deferred-effect.types.ts)
  (AwaitingPredicate, DeferredFluxEvent).
- Mémoire `cost-before-overlay-failed-2026-05-25` — antipatterns DEP
  (4 designs revertés, pitfalls dans `_bmad-output/planning-artifacts/cost-before-overlay-pitfalls-2026-05-25.md`).
- CLAUDE.md : sections « DeferredEffectProcessor », « Perspective
  Convention », « Async Handler Lock Contract », « MR5 EMZ convention ».
