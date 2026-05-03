# Yu-Gi-Oh! Canonical Rules Reference (LLM-optimized)

**Purpose**: single source of truth for Yu-Gi-Oh! TCG rulings, optimized for LLM agent consumption. Used by Path β subagents to disambiguate card text without WebFetch.

**Format**: markdown with dense tables and oracle-verified card examples. Each card example carries its `cardId` from the local `cards.cdb`. Examples cite the relevant clause of the actual oracle text — no paraphrasing.

**Sources**: Konami Master Rules (current MR5 / April 2020 revision), Konami Problem-Solving Card Text (PSCT 2011+), Konami official rulings DB, Yugipedia rulings pages.

**Authority**: this doc is canonical. If a ruling here conflicts with subagent memory or LLM training data, **trust this doc**. If a ruling is missing or ambiguous, the subagent must report the gap as feedback rather than guessing.

---

## §1 Card Grammar (PSCT — Problem-Solving Card Text)

PSCT is Konami's standardized card-text format since 2011. Every modern card oracle follows PSCT; legacy cards have been errata'd to comply. This section defines the parsing rules.

### §1.1 Effect structure

PSCT effects follow this canonical pattern:

```
[Activation condition]: [Cost (if any)]; [Effect].
```

**Markers**:

| Marker | Role | Position |
|---|---|---|
| `:` (colon) | Separates activation condition from what follows | Between condition and cost/effect |
| `;` (semicolon) | Separates cost from effect | Between cost and effect |
| `.` (period) | Ends the complete effect statement | After effect |

**Parsing rule**: text *before* `:` = condition (must be true at activation only, unless re-stated). Text *between* `:` and `;` = cost (paid at activation, before resolution). Text *after* `;` = effect (resolved on chain).

If a card has no cost, the structure collapses to `[Condition]: [Effect].` (no `;`).

**Example — full structure**: Solemn Judgment (cardId 41420027):
> *"When a monster(s) would be Summoned, OR a Spell/Trap Card is activated**:** Pay half your LP**;** negate the Summon or activation, and if you do, destroy that card."*

- Condition: `When a monster(s) would be Summoned, OR a Spell/Trap Card is activated`
- Cost: `Pay half your LP`
- Effect: `negate the Summon or activation, and if you do, destroy that card`

### §1.2 Chain link creation

| Card-text contains | Creates chain link? |
|---|---|
| `:` only | YES |
| `;` only | YES |
| both `:` and `;` | YES |
| neither `:` nor `;` | **NO** |

**Rule (corollary)**: an oracle text without `:` or `;` describes either a Continuous Effect (always-on while face-up), a Summoning Condition, a Lingering Effect clause, or a card-property statement. These do **not** activate, do **not** form chain links, and **cannot be negated by counter-traps or activation-negation cards**.

**Example — no chain link, summoning condition**: Cyber Dragon (cardId 70095154):
> *"If only your opponent controls a monster, you can Special Summon this card (from your hand)."*

No `:`, no `;`. The Special Summon is a **summoning condition**, not an effect activation. Counter Traps (Solemn Strike, Solemn Judgment) cannot negate this Special Summon because there is no chain link to negate. Effect-negation cards that target activations (e.g. "Negate the activation of an effect") do nothing here.

**Example — no chain link, continuous clause**: Macro Cosmos (cardId 30241314), continuous portion:
> *"While this card is face-up on the field, any card sent to the GY is banished instead."*

This clause has no `:` or `;`. It is a Continuous Effect — applied permanently while the card is face-up, never activates, never forms a chain link.

(Macro Cosmos's separate clause `"When this card is activated: You can Special Summon..."` is a normal chain-creating activation; the two clauses coexist on one card.)

### §1.3 Conjunctions and resolution semantics

Effects often chain multiple actions. PSCT uses specific connector words to encode causation and timing.

| Connector | Resolution timing | If A fails | If B fails |
|---|---|---|---|
| `and` (standalone) | Simultaneous | Entire effect does nothing | Entire effect does nothing |
| `, then` | Sequential (B after A) | B does not occur | A still occurred |
| `, and if you do,` | Simultaneous | B does not occur | A still occurred (succeeds independently) |
| `, also` | Simultaneous (independent) | B still occurs | A still occurred |
| `, also, after that,` | Sequential (B after A) | B does not occur | A still occurred |

**Critical distinction**: `then` vs `and if you do` — both make B depend on A succeeding, but their resolution timing differs (sequential vs simultaneous). This affects card-trigger windows.

**Note on standalone `and`**: rare in modern card design. When an oracle text uses standalone `and` (no comma before, no "if you do" clause), it joins A and B as an indivisible all-or-nothing operation — if either A or B cannot be performed, the entire effect does nothing. Modern PSCT prefers `, and if you do,` or `, then` for explicit semantics; standalone `and` is reserved for tightly-coupled mandatory pairs.

**Example — standalone `and`**: Number 53: Heart-eartH (cardId 23998625):
> *"If this card on the field is destroyed by a card effect while it has no material: Special Summon 1 'Number 92: Heart-eartH Dragon' from your Extra Deck **and** attach this card from the GY to it as material."*

The Special Summon and the attach are bound by standalone `and`. If Number 92 is not in the Extra Deck (already summoned, banished, etc.), the entire effect fails — Number 53 is not attached either, even though it's already in the GY ready to be attached.

**Example — `, then`**: Fire King High Avatar Kirin (cardId 2526224):
> *"...You can Special Summon 1 'Fire King' monster from your hand or GY, except 'Fire King High Avatar Kirin', **then** you can destroy 1 card on the field."*

Sequential. The Special Summon resolves first; only after it succeeds does the destroy clause attempt. If Special Summon fails (no valid target, no room), destroy does not occur. The destroy is also optional (`you can`), so the player may decline it even when Special Summon succeeded.

**Example — `, and if you do,`**: Ultimate Conductor Tyranno (cardId 18940556):
> *"...You can destroy 1 monster in your hand or field, **and if you do**, change all face-up monsters your opponent controls to face-down Defense Position."*

Simultaneous. Both halves of the effect resolve at the same moment. If the destroy fails (no valid monster), the change-position clause does not occur. If the change fails (no opponent monsters), the destroy still occurred.

### §1.4 Targeting

**Rule**: an effect targets if and only if the word `target` appears in the relevant clause of the oracle text. No `target` = no targeting.

**Implications of targeting**:
- Targets are chosen at activation (before the chain resolves).
- Cards immune to targeting effects ("Cannot be targeted by card effects") block the targeting effect.
- If the target becomes invalid before resolution (leaves field, becomes face-down, etc.), specific resolution rules apply (see PSCT pronoun rules).
- Cards without `target` can still affect specific cards but are **not** subject to targeting immunity.

**Example — targets**: Raigeki Break (cardId 4178474):
> *"Discard 1 card, then **target** 1 card on the field; destroy it."*

Targets one specific card. Cannot affect cards immune to targeting effects.

**Example — does NOT target**: Raigeki (cardId 12580477):
> *"Destroy all monsters your opponent controls."*

No `target` keyword. Affects all opponent monsters, including those immune to targeting effects (unless they're also immune to non-targeting destruction).

### §1.5 Destruction

**Rule**: an effect destroys if and only if the word `destroy` appears in the relevant clause. Other removal verbs (`send to GY`, `banish`, `bounce`, `tribute`) are not destruction. Effects that trigger on destruction (e.g., "If this card is destroyed and sent to the GY") only fire on `destroy` events, not on other removals.

**Example**: Babycerasaurus (cardId 36042004):
> *"If this card is **destroyed** by card effect and sent to the GY: Special Summon 1 Level 4 or lower Dinosaur monster from your Deck."*

Triggers on destruction-by-card-effect → send-to-GY. If Babycerasaurus is sent to GY without being destroyed (e.g., as a Fusion material via "send to GY" wording, or used as a Tribute), this effect does not trigger.

### §1.6 Cost vs Effect (for triggered actions)

**Rule**: an action listed *before* the `;` is a **cost** (paid at activation, before chain resolution). An action listed *after* the `;` is part of the **effect** (resolved on the chain).

**Critical distinction**: triggered effects that activate on a specific game action (e.g., "If a card is discarded") **only trigger when the action is part of an effect**, not when the action is paid as a cost. Cost-paid actions do not trigger effect-triggers.

**Example — discard as cost**: Raigeki Break (cardId 4178474):
> *"**Discard 1 card**, then target 1 card on the field; destroy it."*

The discard is before the implicit `;` (between `target` and `destroy`). It's a **cost**. Cards with on-discard triggers (e.g., Dark World monsters discarded by effect, Hand-Trap-class cards) **do not** trigger when discarded by Raigeki Break.

**Example — discard as effect**: Dark World Dealings (cardId 74117290):
> *"Each player draws 1 card, then each player **discards 1 card**."*

The discard is part of the effect (after `then`, no semicolon separating it). Cards with on-discard triggers (Dark World monsters specifically) **do** trigger when discarded by Dark World Dealings.

### §1.7 "If" vs "When" — missing the timing

PSCT distinguishes two trigger forms for events:

| Form | Activation timing | Can miss timing? |
|---|---|---|
| `When [event] happens, you can [Y]` | Immediately after the event | **YES** — if event is buried mid-chain (not the last resolved action), effect cannot activate |
| `When [event] happens, [Y]` (mandatory, no "you can") | Immediately after the event | **YES** — same miss-timing rules apply |
| `If [event] happens, [you can] [Y]` | Next legal opportunity after the event | **NO** — never misses timing |
| `Each time [event] happens, [Y]` | Each occurrence | **NO** — never misses timing |

**Rule**: "When" effects strictly require the trigger event to be the **last action that happened**. If anything else occurs after (e.g., a chain link resolves further, a cost is paid, a sub-effect fires), the "When" effect misses its window and cannot activate that round.

**Example — "When… you can" can miss timing**: Peten the Dark Clown (cardId 52624755):
> *"**When** this card is sent to the GY: You can banish this card from your GY; Special Summon 1 'Peten the Dark Clown' from your hand or Deck."*

If Peten is tributed *as part of a Tribute Summon procedure* (where the Tribute Summon itself is the last action), Peten's effect misses timing — the Tribute Summon completed after Peten was sent to GY. Peten cannot revive itself.

**Example — "If… you can" never misses**: Performage Trick Clown (cardId 67696066):
> *"**If** this card is sent to the GY: You can target 1 'Performage' monster in your GY; Special Summon it..."*

Trick Clown's effect can always activate at the next opportunity, regardless of what happened after it was sent to GY. The "If" wording bypasses miss-timing entirely.

### §1.8 "you can" — optional vs mandatory

**Rule**: presence of the phrase `you can` makes the effect **optional**. The player chooses to activate or decline. Absence makes the effect **mandatory** — it triggers automatically whenever the condition is met.

| Wording | Player choice |
|---|---|
| `If [event]: You can [Y]` | Optional — player may decline |
| `If [event]: [Y]` (no "you can") | Mandatory — fires automatically |
| `When [event]: You can [Y]` | Optional + miss-timing-prone |
| `When [event]: [Y]` (no "you can") | Mandatory + miss-timing-prone |

**Example — mandatory**: Babycerasaurus (cardId 36042004):
> *"If this card is destroyed by card effect and sent to the GY: Special Summon 1 Level 4 or lower Dinosaur monster from your Deck."*

No `you can`. Mandatory. If a valid target exists in the deck, it MUST Special Summon. The owner cannot decline. (This matters for combo planning: a mandatory trigger will fire even when you'd prefer it didn't — e.g., if you have no valid target the effect fizzles, but if you do, it's forced.)

**Example — optional**: Performage Trick Clown (cardId 67696066):
> *"If this card is sent to the GY: **You can** target 1 'Performage' monster in your GY..."*

Player may activate or decline.

---

## §2 Effect Categories & Activation

This section catalogs the effect categories (monster effects + spell/trap effects), their activation timing, and the special class of Lingering Effects.

### §2.1 Monster effect categories

Five categories. Each card oracle text identifies its category via wording markers.

| Category | Activation timing | Spell Speed | Wording marker | Misses timing? |
|---|---|---|---|---|
| **Ignition** | Player's own Main Phase only | SS1 | No event trigger; player-initiated. Often `Once per turn:` or `During your Main Phase:` followed by activation cost | N/A (player initiates) |
| **Trigger** | Immediately after a specific event | SS1 | `When [event] happens` or `If [event] happens` (mandatory or optional) | YES if "When" + "you can" (§1.7) |
| **Quick** | Either player's turn, near any time | SS2 | `(Quick Effect)` annotation in the oracle | N/A |
| **Continuous** | Always-on while face-up | N/A — does not activate | No `:` or `;` (see §1.2). Wording like `While this card is face-up...` or unconditional clauses | Never activates |
| **Flip** | Immediately after the monster is flipped face-up | SS1 | `FLIP:` prefix in the oracle | YES (Flip is a "When"-class trigger) |

**Example — Ignition**: Galaxy-Eyes Cipher Dragon (cardId 18963306):
> *"Once per turn: You can detach 1 material from this card, then target 1 face-up monster your opponent controls; monsters you control cannot attack your opponent directly for the rest of this turn..."*

`Once per turn:` (Main Phase only, no event trigger, player-initiated) + cost (detach 1 material) + targeting + effect. Pure Ignition Effect. Same activation rules as a Normal Spell — own Main Phase, SS1, can be chained to by SS2/SS3 only.

**Example — Trigger (optional)**: Performage Trick Clown (cardId 67696066):
> *"If this card is sent to the GY: **You can** target 1 'Performage' monster in your GY; Special Summon it..."*

`If [event]: You can [effect]`. Optional (player chooses). Cannot miss timing (uses "If").

**Example — Trigger (mandatory)**: Babycerasaurus (cardId 36042004):
> *"If this card is destroyed by card effect and sent to the GY: Special Summon 1 Level 4 or lower Dinosaur monster from your Deck."*

`If [event]: [effect]`. No `you can` — mandatory. The owner cannot decline. Triggers automatically when the condition is met and a valid target exists.

**Example — Quick Effect**: Effect Veiler (cardId 97268402):
> *"During your opponent's Main Phase **(Quick Effect)**: You can send this card from your hand to the GY, then target 1 Effect Monster your opponent controls; negate the effects..."*

`(Quick Effect)` annotation marks SS2 status. Activatable on the opponent's turn. Can be chained to other SS2 effects.

**Example — Continuous Effect**: Skill Drain (cardId 82732705):
> *"Activate this card by paying 1000 LP. Negate the effects of all face-up monsters while they are face-up on the field (but their effects can still be activated)."*

The activation clause `Activate this card by paying 1000 LP` creates a chain link (the card's activation), but the continuous portion `Negate the effects of all face-up monsters while they are face-up on the field` has no `:` or `;` — it's a Continuous Effect, applied permanently while Skill Drain is face-up. Cannot be negated by activation-negation cards because it doesn't activate.

**Example — Flip Effect**: Man-Eater Bug (cardId 54652250):
> *"**FLIP:** Target 1 monster on the field; destroy it."*

`FLIP:` prefix. Triggers when the monster is flipped face-up (by Flip Summon, by attack, by effect). SS1, "When"-class — can miss timing.

### §2.2 Spell Speed

| Speed | Categories | Can chain to |
|---|---|---|
| **SS1** | Normal Spells, Ritual Spells, Continuous Spells, Equip Spells, Field Spells, Ignition Effects, Trigger Effects, Flip Effects, all Continuous Effects | Cannot chain to anything — must start a chain or sit at chain link 1 |
| **SS2** | Quick-Play Spells, all Traps except Counter, Quick Effects | SS1, SS2 |
| **SS3** | Counter Traps only (Solemn Judgment, Solemn Strike, Red Reboot, Dark Bribe) | SS1, SS2, SS3 |

**Rule**: a lower-speed effect cannot be chained on top of a higher-speed effect. If your opponent activates a Quick Effect (SS2), you cannot respond with an Ignition Effect (SS1) — only SS2 or SS3 can chain.

**Example**: Solemn Judgment (cardId 41420027) — Counter Trap, SS3.
> *"When a monster(s) would be Summoned, OR a Spell/Trap Card is activated: Pay half your LP; negate the Summon or activation, and if you do, destroy that card."*

Activates on opponent's Summon or S/T activation. As SS3, can chain to SS1, SS2, SS3 — including chaining to another Counter Trap.

### §2.3 Lingering Effects

A **Lingering Effect** is an effect that, once applied, persists for a specified duration regardless of whether the source card remains face-up or in play.

**Defining property**: once the lingering effect has been applied (i.e., its source effect resolved and produced the lingering state), it **cannot be negated**. Only the *initial activation* of the source effect can be negated, before the lingering effect is applied.

**Common wording patterns** (case-insensitive):
- `for the rest of this turn` — lingers until the End Phase
- `until the End Phase` — lingers until the End Phase
- `this turn` (in restriction context) — applies for the entire turn including before the source activated (see §2.4)
- `the turn you activate this card` — applies for the entire turn
- `until the end of this turn` — lingers until the End Phase

**Example — Lingering Effect (post-resolution lock)**: Droll & Lock Bird (cardId 94145021):
> *"If a card(s) is added from the Main Deck to your opponent's hand, except during the Draw Phase (Quick Effect): You can send this card from your hand to the GY; **for the rest of this turn**, cards cannot be added from either player's Main Deck to the hand."*

After Droll resolves, the "no adding from deck" lock persists until the End Phase. Even if Droll is banished or removed from the GY mid-turn, the lock remains. The lock cannot be negated once applied — only the initial Droll activation can be negated (e.g., by Effect Veiler at activation time).

### §2.4 Retroactive lock — "this turn" / "the turn you activate this card"

**Critical rule**: when a card text uses `this turn` or `the turn you activate this card` to describe a restriction, the restriction is checked against **the entire current turn**, not just from the activation moment forward. If the restricted action **has already been performed earlier in the current turn**, the card **cannot be activated** at all.

**Mechanism**: the activation condition is read as "you commit to not having performed [restricted action] this turn, including before this activation". Violating the restriction earlier in the turn invalidates the activation.

**Example — Branded Fusion**: cardId 44362883:
> *"Fusion Summon 1 Fusion Monster that mentions 'Fallen of Albaz' as material from your Extra Deck, using 2 monsters from your hand, Deck, or field as Fusion Material. **You cannot Special Summon monsters from the Extra Deck, except Fusion Monsters, the turn you activate this card.** You can only activate 1 'Branded Fusion' per turn."*

The lock `You cannot Special Summon monsters from the Extra Deck, except Fusion Monsters` applies for **the entire turn**. Concrete consequences:

1. **If Branded Fusion is activated FIRST** in the turn: any subsequent non-Fusion ED summon (Synchro, Xyz, Link) is blocked for the rest of the turn.
2. **If a non-Fusion ED summon happens BEFORE Branded Fusion in the same turn** (e.g., Synchro Summon Eccl-DD, then attempt Branded Fusion): **Branded Fusion cannot be activated**. The activation condition retroactively fails because the turn already contains a non-Fusion ED summon, violating the "the turn you activate this card" lock.

**Solver implication**: when checking if `Branded Fusion` is activatable mid-turn, the engine must scan the turn's ED-summon history. If any non-Fusion ED summon has occurred, Branded Fusion's activation prompt does not surface in legal actions. This is enforced silently by OCGCore — the card simply does not appear in `activates[]` of SELECT_IDLECMD when the lock condition has been violated.

This rule is a frequent source of LLM misreasoning. Subagents commonly assume "lock activates AFTER the card resolves" — wrong. The check is bidirectional across the entire turn.

### §2.5 Summoning conditions vs effects

A **Summoning Condition** describes how a monster can be Special Summoned without activating an effect or creating a chain link. Recognized by absence of `:` or `;` in the relevant clause (see §1.2).

| Mechanism | Creates chain link? | Negatable by activation negation? | Negatable by effect negation? |
|---|---|---|---|
| Summoning condition (no `:` no `;`) | NO | NO | NO (the SS is not an effect) |
| Special Summon via Trigger Effect | YES | YES (if response window exists) | YES |
| Special Summon via Ignition Effect | YES | YES | YES |
| Special Summon via Quick Effect | YES | YES | YES |

**Example — Summoning Condition**: Cyber Dragon (cardId 70095154):
> *"If only your opponent controls a monster, you can Special Summon this card (from your hand)."*

No `:` no `;`. Not an effect. Counter Traps cannot negate this Special Summon. Solemn Strike (which negates monster effect activations and Summons "during the activation") **can** negate the Summon itself (Solemn Strike's wording targets summons, not just effect activations) — but Effect Veiler / Infinite Impermanence (which negate **monster effects**) cannot, because no monster effect is being activated.

**Distinction matters for combo timing**: a monster summoned via summoning condition does not fire Trigger windows that fire on "monster effect activation". A monster summoned via Trigger/Quick/Ignition Effect goes through the chain and triggers all relevant on-activation responses (Ash Blossom on SS-from-deck, etc.).

### §2.6 Spell/Trap card categories (for reference)

| Category | Spell Speed | Activation site | Set-this-turn rule (§8) |
|---|---|---|---|
| Normal Spell | SS1 | Own Main Phase | Can flip-activate same turn as Set |
| Continuous Spell | SS1 | Own Main Phase | Can flip-activate same turn as Set |
| Equip Spell | SS1 | Own Main Phase | Can flip-activate same turn as Set |
| Field Spell | SS1 | Own Main Phase | Can flip-activate same turn as Set |
| Ritual Spell | SS1 | Own Main Phase | Can flip-activate same turn as Set |
| Quick-Play Spell | SS2 | Own turn (any phase) from hand; either turn from face-up Set | **CANNOT** flip-activate same turn as Set |
| Normal Trap | SS2 | Either player's turn from face-up Set | **CANNOT** activate same turn as Set |
| Continuous Trap | SS2 | Either player's turn from face-up Set | **CANNOT** activate same turn as Set |
| Counter Trap | SS3 | Either player's turn from face-up Set | **CANNOT** activate same turn as Set |

See §8 for the full Set-timing rules table.

## §3 Once-Per-Turn (OPT)

OPT clauses control how often a card or effect can be used per turn. PSCT distinguishes multiple variants based on exact wording — the wrong variant assumption is a frequent source of LLM misreasoning.

### §3.1 OPT variant table

| # | Wording pattern | Scope | After negation | Comment |
|---|---|---|---|---|
| **1** | `Once per turn:` (no card name in OPT clause) | Per **instance** (each copy of the card has its own counter) | Negated copy still spent its turn quota for that copy | Soft OPT |
| **2** | `You can only use this effect of "[X]" once per turn` | All copies of named card share one counter | Negated copy spent the shared quota — other copies cannot fire this turn | Hard OPT, name-bound |
| **3** | `You can only use each effect of "[X]" once per turn` | Each effect of named card independently — all copies share per-effect counters | Negated copy spent the per-effect quota | Hard OPT, per-effect granularity |
| **4** | `You can only use 1 of the following effects of "[X]" per turn, and only once that turn` | All listed effects share ONE counter; using one spends them all for that copy | Negated copy spent the entire shared quota | Shared OPT (effect bundle) |
| **5** | `You can only activate 1 "[X]" per turn` | Activation per turn, name-bound | Negated activation does NOT spend the quota — another copy CAN activate | Activate-OPT (lenient) |
| **6** | `Once per Chain` | Per chain, not per turn | (rare; per-chain limits independent of turn) | Chain-OPT |

**Critical distinction — "use" vs "activate"**:
- Variants with `use` (e.g., `You can only use this effect once per turn`) lock the quota even if the activation is negated. The card's turn slot is consumed.
- Variants with `activate` (e.g., `You can only activate 1 [X] per turn`) only lock if the activation actually resolved. A negated activation does not spend the quota.

This distinction is decisive when planning combos that may face Counter Trap negation: an `activate`-OPT card can be re-activated from another copy after negation; a `use`-OPT card cannot.

### §3.2 Examples

**Variant 1 — Soft OPT (per-instance)**: Ultimate Conductor Tyranno (cardId 18940556):
> *"**Once per turn**, during the Main Phase (Quick Effect): You can destroy 1 monster in your hand or field, and if you do, change all face-up monsters your opponent controls to face-down Defense Position."*

`Once per turn:` without card name. Each copy of Tyranno on the field has its own counter — with 2 copies in play, the effect can fire twice per turn (once per copy).

**Variant 2 — Hard OPT (single effect, name-bound)**: I:P Masquerena (cardId 65741786):
> *"...You can only use **this effect of 'I:P Masquerena'** once per turn."*

The card has only one activated effect, and the OPT names the card. All copies of I:P share the counter — even if 2 copies are on the field, the Link-Summon-on-opponent-turn effect can only fire once.

**Variant 3 — Hard OPT (each effect of [X])**: Snake-Eyes Flamberge Dragon (cardId 48452496):
> *"...You can only use **each effect of 'Snake-Eyes Flamberge Dragon'** once per turn."*

Flamberge has 3 distinct activated effects (place-as-Continuous-Spell, Quick-Effect-revive-Continuous-Spell, send-to-GY-trigger). Each effect has its own per-turn counter, but **all copies share the per-effect counter**. Across 2 copies in play, the place-as-Continuous-Spell effect can still only fire once total (not twice).

**Variant 4 — Shared OPT (effect bundle)**: The First Darklord (cardId 4167084):
> *"You can only use **1 of the following effects of 'The First Darklord'** per turn, and only once that turn.
> ● If this card is Fusion Summoned using 'Darklord Morningstar' as material: You can destroy all cards your opponent controls.
> ● During the Main Phase (Quick Effect): You can pay 1000 LP; Special Summon 1 Fairy monster from your hand or GY in Defense Position."*

The two listed effects share ONE per-turn counter. Using either spends the counter for both, for this copy. With 2 copies in play, using effect A on copy 1 does not prevent copy 2 from using effect A or effect B (per-instance counter). But within copy 1, effect B can no longer fire this turn.

**Variant 5 — Activate-OPT (lenient, name-bound)**: Pot of Desires (cardId 35261759):
> *"Banish 10 cards from the top of your Deck, face-down; draw 2 cards. **You can only activate 1 'Pot of Desires' per turn.**"*

If the first Pot of Desires is negated by Solemn Strike, a **second copy can be activated** the same turn — the negated activation did not spend the quota. Compare with `use`-OPT variants: those would have locked the second copy out.

**Variant 6 — Once per Chain**: Apollousa, Bow of the Goddess (cardId 4280258):
> *"...**Once per Chain**, when your opponent activates a monster effect (Quick Effect): You can make this card lose exactly 800 ATK, and if you do, negate the activation."*

Per-chain limit, not per-turn. Apollousa can negate at most one effect per chain link, but multiple chains in the same turn each refresh the per-chain quota.

### §3.3 Composite OPT statements

A single card can carry multiple OPT clauses targeting different aspects. Each clause must be parsed independently.

**Example — composite**: Diabellstar the Black Witch (cardId 72270339):
> *"You can Special Summon this card (from your hand) by sending 1 card from your hand or field to the GY. **You can only Special Summon 'Diabellstar the Black Witch' once per turn this way.** **You can only use each of the following effects of 'Diabellstar the Black Witch' once per turn.**
> ● If this card is Normal or Special Summoned: You can Set 1 'Sinful Spoils' Spell/Trap directly from your Deck.
> ● During your opponent's turn, if this card is sent from its owner's hand or field to the GY: You can send 1 card from your hand or field to the GY, and if you do, Special Summon this card."*

Two separate OPTs:
1. SS-this-way OPT: limits the Special Summon procedure to once per turn (across all copies, name-bound).
2. Hard OPT per-effect: each of the two listed effects has its own per-turn counter.

The Set-Sinful-Spoils trigger and the SS-on-GY trigger have independent counters, but both Diabellstar copies share each per-effect counter.

### §3.4 OPT scope summary table

| OPT variant | Per copy | Per name | After negation locked? |
|---|---|---|---|
| Soft (`Once per turn:` no name) | YES (each copy independent) | NO | YES (the firing copy spent its quota) |
| Hard `use` (`use this effect of [X]`) | NO (all copies share) | YES | YES |
| Hard `use each effect` (`use each effect of [X]`) | NO (per-effect, all copies share) | YES (per effect) | YES (per effect) |
| Shared (`use 1 of the following effects`) | NO (all copies share, all bundled effects share) | YES | YES |
| Activate (`activate 1 [X]`) | name-bound activation | YES | **NO** (negated activations don't spend quota) |
| Once per chain | per-chain | refreshes between chains | depends on chain context |

**Solver implication**: when scoring an interruption attempt, the OPT type determines whether a single negation tokens the whole turn or not. `Activate`-OPT enablers are "softer" interruption targets — negating them costs LP/cards but doesn't shut down the line. `Use`-OPT enablers are "hard" interruption targets — negation kills the line for that turn.

## §4 Chain Mechanics

A **chain** is the formal sequence in which simultaneously-activated effects resolve. Chains are LIFO: the last-added effect resolves first.

### §4.1 Chain construction

A chain has chain link 1 (CL1) at the bottom, CL2 above it, CL_N on top. **Resolution is LIFO**: CL_N resolves first, then CL_(N-1), down to CL1.

Two regimes apply depending on the trigger event:

- **SEGOC regime** (Simultaneous Effects Go On Chain) — used when multiple Trigger Effects must enter the chain simultaneously after a single event. See §4.7.
- **Standard window regime** — used after most game actions (Normal Summon, Spell activation, attack declaration, etc.) where only Quick Effects, Counter Traps, and Spell-Speed-compatible activations may enter. See §4.3.

In both regimes, players add chain links until both consecutively pass; resolution then begins from CL_N.

### §4.2 LIFO resolution

Each chain link resolves fully — including all its sub-effects — before the next link begins resolving. Within one link's resolution, sub-effects fire in their oracle-text order.

**Example** — chain of 2:
- CL1: Solemn Judgment (cardId 41420027) — *"Pay half your LP; negate the Summon or activation, and if you do, destroy that card."*
- CL2: Ash Blossom & Joyous Spring (cardId 14558127) — *"You can discard this card; negate that effect."*

CL2 resolves first → Ash negates Solemn Judgment → CL1 fizzles (its activation was negated, no Summon-negate happens, no destroy happens).

**Critical**: within a single link's resolution, the sub-effects (e.g., the `negate` and `destroy` of Solemn Judgment) are part of the same resolution step, but they're sequenced by their conjunction (see §1.3). `negate the Summon, and if you do, destroy that card` means the destroy depends on the negate succeeding.

### §4.3 Priority and response windows (standard regime)

After most game actions (Normal Summon resolution, Spell/Trap activation resolution, attack declaration, etc.) a response window opens for non-trigger activations: Quick Effects, Counter Traps, and Spell-Speed-compatible chains.

**Priority rule (standard regime)**:

1. The **active player** holds priority first.
2. The active player chooses to activate a Spell-Speed-compatible effect or to pass priority.
3. If the active player passes, priority goes to the **inactive player**.
4. The inactive player chooses to activate or to pass.
5. If both players pass consecutively at the same priority level, the window closes.

This is the **default for Quick Effects post-Summon, post-activation, and post-effect-resolution**. The active player gets the first opportunity; the inactive player only acts if the active player declines.

**Removed legacy rule**: the old "priority rule" let the active player chain an Ignition Effect to their own Normal Summon. Removed in 2014. Current TCG rule: after a Normal Summon, the active player CAN activate a Spell or Quick Effect (priority is theirs first), but no Ignition Effect of the just-Summoned monster can fire ahead of the inactive player's Quick-Effect responses — Ignitions are SS1 and require their own activation window after the Summon resolves and after the Quick-Effect window closes.

**Response window types**:

| Phase | Window | Common responses |
|---|---|---|
| Standby Phase | After mandatory triggers | Cards that trigger on Standby |
| Main Phase 1 | Before each action; after Normal/Flip/Special Summon; after Spell/Trap activation; after Set | Hand traps, Counter Traps, Quick Effects |
| Battle Phase entry | Active player declares Battle Phase | Counter Traps preventing entry (rare) |
| Attack declaration | After attack target declared | Quick effects, Battle Phase traps |
| Damage Step | Before/after damage calculation | Specific Damage-Step-only effects |
| Main Phase 2 | Same as M1 | Same as M1 |
| End Phase | Active player declares End Phase | End-Phase triggers, optional discards if hand > 6 |

The opponent's turn has the same windows from the defender's perspective. **Quick Effects** and **Counter Traps** specifically exist to fire during the opponent's turn windows.

### §4.4 Passing priority

To progress through a chain or window without responding, both players must consecutively pass. If only the active player passes and the inactive player activates, the active player gets priority again — the chain extends.

A chain closes only when both players pass consecutively at the same window. After the chain closes, resolution begins.

### §4.5 Sub-chains and "when the chain resolves"

After a chain fully resolves, **Trigger effects whose conditions were met during the chain's resolution** form a new chain automatically. This is called the "**when the chain resolves**" window.

**Mechanism**:
- During chain resolution, multiple Trigger conditions may be met (e.g., monsters destroyed, cards drawn, effects negated).
- Once all chain links have resolved, all eligible Triggers form a new chain in a single resolution batch.
- "If" Triggers always join this new chain (no miss timing).
- "When" Triggers may miss timing if their event was buried mid-chain (not the last action — see §1.7).

**Example** — Snake-Eyes Flamberge Dragon (cardId 48452496) on-GY trigger:
> *"If this card is sent from the hand or field to the GY: You can Special Summon 2 Level 1 FIRE monsters from your GY."*

If Flamberge is sent to GY mid-chain (e.g., as material for a Fusion Summon resolved at CL2), Flamberge's Trigger uses "If" — it can fire after the chain fully resolves, in the post-resolution window. If it had used "When", it would have missed timing.

### §4.6 Spell Speed in chain construction

| Activating | Can be added on top of |
|---|---|
| SS1 | Cannot chain — only valid as CL1 of an empty chain |
| SS2 | Any chain link of SS1, SS2, or SS3 |
| SS3 | Any chain link of SS1, SS2, or SS3 |

**Rule consequence**: an SS1 effect cannot respond to an SS2 Quick Effect already on the chain. If your opponent activates Effect Veiler (SS2) targeting your monster, you cannot respond with your own monster's Ignition Effect (SS1) to bait or counter.

**Example** — chaining hierarchy:
- Active player Normal Summons (no chain link, but creates a window)
- Inactive player activates Ash Blossom (SS2) targeting the on-Summon Trigger of the summoned monster — chain CL1 = Ash Blossom
- Active player wants to chain a Counter Trap (SS3) to Ash Blossom — legal (SS3 chains to SS2)
- Active player activates Solemn Strike (SS3) — chain CL2 = Solemn Strike
- Both pass. Chain resolves: CL2 Strike fires first, negates Ash, CL1 fizzles.

### §4.7 SEGOC — Simultaneous Effects Go On Chain

When multiple Trigger Effects (mandatory or optional, "If" or "When") satisfy their activation condition due to a **single game event**, they all enter the chain via a strict ordering procedure called **SEGOC**.

**Strict effect-class precedence**: at any priority point in SEGOC, players must place effects in this order before moving to the next class:
1. **Mandatory Triggers** (must be placed; no opt-out)
2. **Optional Triggers** (player elects to place)
3. **Quick Effects** and other non-trigger Spell-Speed-compatible activations

A player with a Mandatory Trigger MUST place it before they can place an Optional Trigger or activate a Quick Effect. The class precedence applies per-priority-step, not per-batch. **Implication**: if the inactive player has a Mandatory Trigger and the active player has none, the inactive player's Mandatory Trigger enters the chain *before* the active player's (Quick Effects or Optional Triggers).

**SEGOC procedure**:

1. **Active player places Mandatory Triggers** (all eligible, in whatever order they choose). If the active player has none, skip to step 2.
2. **Inactive player places Mandatory Triggers** (all eligible, in whatever order they choose).
3. **Active player places Optional Triggers** (those they elect to activate, in whatever order they choose).
4. **Inactive player places Optional Triggers** (those they elect to activate, in whatever order they choose).
5. **Non-trigger window opens** for Quick Effects, Counter Traps, and other Spell-Speed-compatible activations. Priority depends on which player most recently added a chain link in steps 1–4:
   - If the **inactive player** added the last chain link in steps 1–4 (i.e., placed at least one Optional Trigger in step 4, or placed Mandatory Triggers in step 2 and the active player added nothing in steps 3–4) → priority for the non-trigger window goes to **the active player** (they respond to the inactive's last addition).
   - If the **active player** added the last chain link → priority goes to **the inactive player**.
   - If neither player added any Triggers (steps 1–4 all empty) → priority follows the standard regime (§4.3): active player first.
6. The non-trigger window proceeds with normal priority (§4.3). Both must pass consecutively for the chain to close.
7. Once the chain closes, resolution begins (LIFO from CL_N).

**Trigger ordering within one player's batch**: when a player has multiple Triggers of the same class (e.g., 2 simultaneously-destroyed Babycerasaurus, both mandatory) the player chooses the order they enter the chain. There is no fixed precedence between cards.

**Example — SEGOC with 2 mandatory + 1 optional**:
- Event: a monster is destroyed and sent to GY.
- Active player has: Babycerasaurus (cardId 36042004, **mandatory** Trigger to Special Summon a Dinosaur) and Performage Trick Clown (cardId 67696066, **optional** Trigger to Special Summon a Performage).
- Inactive player has: a **mandatory** Trigger of their own (e.g., a "If a monster is sent to your opponent's GY..." mandatory effect).

Procedure:
1. Active player places Babycerasaurus (mandatory) on CL1.
2. Inactive player places their mandatory Trigger on CL2.
3. Active player places Performage Trick Clown (optional) on CL3, if they elect to activate it.
4. Inactive player places no Optional Triggers.
5. Active player added the last chain link (CL3) → priority for the non-trigger window goes to **the inactive player**.
6. Inactive player can activate a Quick Effect (CL4) or pass; standard priority thereafter.
7. Chain resolves LIFO: CL_N → … → CL1.

**Implication for combo planning**:
- Mandatory Triggers cannot be skipped — combo lines must absorb their outcome.
- Class precedence (Mandatory > Optional > Quick) means the active player cannot inject a Quick Effect ahead of the inactive player's Mandatory Trigger.
- Within a player's batch of same-class Triggers, the player chooses the chain order. LIFO resolution ⇒ later chain links resolve first.
- Active player's most-important Triggers should be placed at the **bottom** of their own batch if they want them to resolve last (most reliably).

### §4.8 Sub-effects of one card (single chain link)

A single card's effect resolution can spawn multiple sub-effects bound by conjunctions (see §1.3) — but **all sub-effects of one effect activation are part of the same chain link**, resolving as a single LIFO unit.

This means:
- Sub-effects of one card cannot be individually negated by interrupting the chain mid-resolution. The whole link is one atomic resolution.
- Cards that "negate the activation" or "negate the effect" of a chain link affect all of that link's sub-effects.
- Triggers fired by sub-effects (e.g., a destroy triggering an on-destruction effect) join the post-resolution chain (§4.5), not the active chain.

## §5 Summon Procedures

This section catalogs every way a monster can enter the field, with material requirements, source zones, destination zones, and token compatibility for each.

### §5.1 Summon types overview

| Type | Source | Cost (materials) | Destination | Creates chain link? | Tokens as material? |
|---|---|---|---|---|---|
| Normal Summon | HAND | 1-tribute (Lv5-6) or 2-tribute (Lv7+) for high-Level monsters | Empty MZ | NO | YES (Tribute only) |
| Set (face-down) | HAND | Same as Normal Summon | Empty MZ (face-down DEF) | NO | YES (Tribute only) |
| Flip Summon | Field (face-down DEF) | None | Same MZ (flipped face-up ATK) | NO | N/A |
| Special Summon (effect) | Various (Hand/Deck/GY/Banished/ED) | Defined by activating effect | Empty MZ (or per effect) | YES (the effect activates) | Depends on effect |
| Special Summon (procedure / condition) | Hand/GY/etc. (per condition) | Defined by the procedure | Empty MZ | NO (no chain link) | Depends on procedure |
| Fusion Summon | ED (specific Fusion Monster) | Materials per Fusion's text, sent to GY | Empty MZ | YES (the Fusion-Spell or effect activates) | YES |
| Synchro Summon | ED (specific Synchro Monster) | 1 Tuner + 1+ non-Tuners on field, total Levels = Synchro Lv | Empty MZ | NO (Synchro Summon itself is not chained) | YES |
| Xyz Summon | ED (specific Xyz Monster) | 2+ face-up monsters with same Level, attached as Materials | Empty MZ | NO | **NO** (tokens cannot be Xyz Materials) |
| Link Summon | ED (specific Link Monster) | Effect monsters on field, count = Link Rating | EMZ or MZ pointed by a Link arrow | NO | YES (vanish instead of GY) |
| Pendulum Summon | HAND + face-up ED Pendulum monsters | Pendulum Scales in S1 + S5 | HAND→any empty MZ; ED→EMZ or linked MZ | NO | N/A |
| Ritual Summon | HAND (specific Ritual Monster) | Tributes from Hand/Field, total Levels ≥ Ritual Lv | Empty MZ | YES (Ritual Spell activates) | YES |

### §5.2 Normal Summon / Set

Each player may Normal Summon or Set **once per turn** (unless an effect grants additional Normal Summons).

| Monster Level | Tribute cost |
|---|---|
| 1-4 | None (free) |
| 5-6 | 1 Tribute |
| 7+ | 2 Tributes |

**Rules**:
- Source zone: HAND only (cannot Normal Summon from Deck/GY/Banished — those require Special Summon).
- Destination: any empty Main Monster Zone (MZ1-MZ5). Cannot Normal Summon to EMZ.
- Set vs Summon: Set places face-down DEF instead of face-up ATK; cost is the same. The monster does not appear face-up until Flipped (by Flip Summon, attack, or effect).
- Normal Summon does NOT create a chain link. Trigger Effects "When/If summoned" activate after the Summon completes (in the post-Summon response window).

**Tribute targets**: face-up or face-down monsters on the player's own field. Sent to GY (Pendulum redirect applies — see §6).

### §5.3 Flip Summon

A player may Flip Summon a face-down DEF monster on their field to face-up ATK. Costs nothing. Available during Main Phase only (own turn).

- Triggers Flip Effects (cards with `FLIP:` in their oracle).
- The monster goes from face-down DEF to face-up ATK in its current zone.
- Cannot be performed on a monster Set this turn (Set this turn = cannot Flip Summon until next turn).

### §5.4 Special Summon

A monster may be Special Summoned by:
- An effect (Trigger / Quick / Ignition that resolves to "Special Summon X"),
- A procedure / summoning condition (no chain link, see §2.5),
- A specific summon mechanic (Fusion / Synchro / Xyz / Link / Pendulum / Ritual — sub-categories).

**No per-turn limit on Special Summons**, unless restricted by a card text (e.g., `You can only Special Summon "[X]" once per turn this way`).

**Source zones**: Hand, Deck, GY, Banished, Extra Deck — depends on the activating effect or procedure.

**Destination**: any empty MZ unless the summon mechanic restricts it (Link → EMZ/linked MZ; Pendulum from face-up ED → EMZ/linked MZ).

**Position**: face-up ATK or face-up DEF — varies by effect (default face-up ATK if not specified). Face-down DEF only via specific effects that say "Special Summon, but in face-down Defense Position".

### §5.5 Fusion Summon

**Procedure**:
1. Activate a Fusion-summoning Spell (Polymerization, Branded Fusion, etc.) or use a Fusion Monster's own ability.
2. Send the Fusion Materials listed on the Fusion Monster's text from the legal source zones to the GY (or banish, depending on the Fusion's text).
3. Special Summon the Fusion Monster from the ED to an empty MZ.

**Material source zones**: depend on the activating Fusion-Spell or effect:
- Polymerization → Hand or Field.
- Branded Fusion (cardId 44362883) → Hand, Deck, or Field. *"Fusion Summon 1 Fusion Monster... using 2 monsters from your hand, Deck, or field as Fusion Material."*
- Super Polymerization → Both players' fields (and Hand for some variants).
- Each Fusion-summoning effect specifies its allowed source zones.

**Material destination**: Fusion Materials are typically **sent to the GY** (subject to Pendulum redirect — see §6). Some effects banish them instead (e.g., Albion the Branded Dragon's sub-fusion).

**Material requirements (on the Fusion Monster's text)**: must satisfy the listed materials. Wording specifics:
- `1 [type] + 1+ [type]` — at least 1 of each listed type, totals as specified.
- `from your hand` or `from the hand` — restricts that material to specifically be from the hand.
- `1 [name] + 1 [name]` — exactly the named monsters.
- Tokens generally CAN be Fusion Materials unless the text says otherwise.

**Destination zone**: any empty MZ (MR5: no EMZ-only restriction for Fusion — see §7).

### §5.6 Synchro Summon

**Procedure**:
1. Choose 1 Tuner monster + 1 or more non-Tuner monsters, all face-up on your field.
2. Sum their Levels. The total must equal the Synchro Monster's Level exactly.
3. Send all chosen materials to the GY (Pendulum redirect applies).
4. Special Summon the Synchro Monster from the ED to an empty MZ.

**Rules**:
- The Synchro Summon procedure itself does NOT create a chain link (it's like a summoning condition).
- Tokens CAN be Synchro materials.
- All materials must be face-up on the field (cannot use face-down DEF monsters).
- Materials cannot include Xyz Materials (those are not "on the field" — see §9).

**Destination zone**: any empty MZ (MR5: no EMZ-only restriction).

### §5.7 Xyz Summon

**Procedure**:
1. Choose 2 or more face-up monsters on your field with the same Level (matching the Xyz Monster's Rank).
2. Stack the chosen monsters as **overlay materials** underneath the Xyz Monster.
3. Special Summon the Xyz Monster from the ED to an empty MZ; the materials remain attached underneath.

**Critical rules**:
- Xyz Summon itself does NOT create a chain link.
- **Tokens CANNOT be Xyz Materials.** This is the only summon type with this restriction. If a Token is among the chosen materials, the summon fails.
- Materials are attached under the Xyz Monster; they are **not "on the field"** while attached (see §9 for Xyz Material rules).
- Rank ≠ Level — Xyz Monsters have Ranks (the number requirement matches all materials' Levels).

**Destination zone**: any empty MZ (MR5: no EMZ-only restriction).

**Xyz Evolution (Rank-Up)**: an Xyz Monster can itself be used as Xyz Material for another Xyz Summon. Both the Xyz Monster and any materials it had become materials of the new Xyz Monster (the "stack" is preserved beneath the new monster).

### §5.8 Link Summon

**Procedure**:
1. Choose Effect Monsters on your field (the count equals the Link Rating of the Link Monster).
2. Send all chosen materials to the GY (Pendulum redirect applies).
3. Special Summon the Link Monster from the ED to:
   - The Extra Monster Zone (EMZ-L or EMZ-R), OR
   - A Main Monster Zone pointed to by **any Link Monster's arrow** (yours or your opponent's).

**Rules**:
- Link Summon does NOT create a chain link.
- Link Monsters are always **face-up ATK**. They have no DEF position; cannot be Set; cannot be flipped.
- A Link Monster used as Link Material can count as **1 OR as its Link Rating** (player chooses). E.g., a Link-3 monster used as material counts as 1 Effect Monster *or* 3 Effect Monsters for the new Link Summon.
- Materials must be Effect Monsters (not Normal Monsters, in most cases — read the Link Monster's text for restrictions like "Effect Monsters" vs "monsters" vs specific archetypes).
- Tokens CAN be Link Materials, but they vanish instead of going to GY.

**Destination zone**: EMZ or any MZ pointed by a Link arrow. This is the **MR5 restriction** that applies to Link Monsters specifically (and Pendulum-from-ED — see §5.10).

### §5.9 Ritual Summon

**Procedure**:
1. Activate a Ritual-summoning Spell (the Ritual Spell named in the Ritual Monster's text).
2. Tribute monsters from your Hand or Field whose total Levels are ≥ the Ritual Monster's Level (some Ritual Spells require exact match — read the Ritual Spell's text).
3. Special Summon the Ritual Monster from your Hand to an empty MZ.

**Rules**:
- Ritual Summon creates a chain link via the Ritual Spell's activation (the Ritual Spell is the chain link; the Ritual Summon is the resolution effect).
- Tributes are sent to GY (Pendulum redirect applies).
- Tokens CAN be Ritual Tributes (they vanish instead of GY).
- Source zone for Ritual Monster: HAND (some Ritual Spells allow GY).

### §5.10 Pendulum Summon

**Prerequisites**:
- A Pendulum Monster placed in the Left Pendulum Zone (S1 in MR5), face-up.
- A Pendulum Monster placed in the Right Pendulum Zone (S5 in MR5), face-up.
- The two Scale values define an open range: Levels strictly between the two Scales (exclusive).

**Procedure**:
1. Choose Pendulum Monsters from your Hand and/or your face-up Extra Deck whose Levels are strictly within the Scale range.
2. Special Summon them all simultaneously.

**Rules**:
- Pendulum Summon is **once per turn** (the player can only Pendulum Summon once during their turn).
- Pendulum Summon does NOT use the Normal Summon for the turn.
- Pendulum Summon does NOT create a chain link.
- Tokens are NOT relevant (Pendulum Monsters are never Tokens).

**Destination zones**:
- Pendulum Monster from **Hand** → any empty MZ (no MR5 restriction).
- Pendulum Monster from **face-up ED** → EMZ or MZ pointed by a Link arrow (MR5 restriction applies).

**Scale range example**: Scale 1 + Scale 8 → Pendulum Summon Levels 2-7 (strictly between, so 2, 3, 4, 5, 6, 7).

### §5.11 Special Summon constraints — common patterns

**Procedure-vs-effect distinction** (see §2.5):
- A Special Summon via "summoning condition" (no `:` no `;` in text) does NOT create a chain link. Cyber Dragon's `If only your opponent controls a monster, you can Special Summon this card (from your hand)` is an example.
- A Special Summon via Trigger/Quick/Ignition Effect creates a chain link (the effect activates, resolves, and the SS happens at resolution).

**"Once per turn this way"** restriction:
- A common modern wording: `You can only Special Summon "[X]" once per turn this way.`
- This applies to the Summon procedure regardless of which copy is used. With 2 copies in hand, only 1 can be Summoned by this method per turn.
- This restriction is independent of effect-OPT clauses on the same card.

**Example**: Diabellstar the Black Witch (cardId 72270339):
> *"You can Special Summon this card (from your hand) by sending 1 card from your hand or field to the GY. **You can only Special Summon 'Diabellstar the Black Witch' once per turn this way.**"*

The summoning procedure uses no `:` or `;` (it's a summoning condition, not an activated effect). The OPT clause limits the procedure across all copies.

### §5.12 Master Rule 5 (April 2020) — destination summary

| Summon type | Destination |
|---|---|
| Normal Summon / Set | Any empty MZ (MZ1-MZ5) |
| Fusion Summon | Any empty MZ (MZ1-MZ5 or EMZ) — no Link-arrow requirement |
| Synchro Summon | Any empty MZ (MZ1-MZ5 or EMZ) — no Link-arrow requirement |
| Xyz Summon | Any empty MZ (MZ1-MZ5 or EMZ) — no Link-arrow requirement |
| Link Summon | EMZ OR MZ pointed by any Link arrow (yours or opponent's) |
| Pendulum from Hand | Any empty MZ (MZ1-MZ5) |
| Pendulum from face-up ED | EMZ OR MZ pointed by any Link arrow |
| Ritual Summon | Any empty MZ (MZ1-MZ5) |
| Special Summon (effect/procedure, non-ED) | Any empty MZ specified by the effect |

**Strategic note** (skytrix-specific): although Fusion/Synchro/Xyz CAN land in EMZ, competitive play almost always routes them to MZ1-MZ5 to keep the EMZ free for a future Link Summon. EMZ is a scarce resource — putting non-Link in EMZ blocks Link-ladder plays.

## §6 State Transitions (Card Movements)

This section catalogs every way a card can move between zones, with redirect rules and ordering constraints. Most movements have side effects (Pendulum redirect, ED redirect, token vanish) that change the actual destination zone.

### §6.1 Movement vocabulary

| Verb | Source → Destination | Notes |
|---|---|---|
| **Draw** | Top of Main Deck → Hand | Cannot draw if Main Deck is empty (= deck-out / fail state) |
| **Search** | Main Deck (player chooses) → Hand | Post-action: shuffle Main Deck |
| **Mill** | Top of Main Deck → GY | No shuffle |
| **Excavate** | Top N of Main Deck → temporarily revealed → distributed per effect | Shuffle if deck was searched |
| **Discard** | Hand → GY | Pendulum redirect does NOT apply (HAND is not a field zone) |
| **Send to GY** | Any zone → GY | Pendulum redirect applies if source = field; ED redirect applies for ED monsters |
| **Banish (face-up)** | Any zone → Banished face-up | Pendulum redirect does NOT apply — banishing is not "sent to GY" |
| **Banish (face-down)** | Any zone → Banished face-down | Same — no Pendulum redirect; face-down banished is private to the owner |
| **Return to Hand (Bounce)** | Field → Hand | ED monsters bounced "to hand" → ED face-down instead |
| **Return to Deck** | Any zone → Main Deck (top, bottom, or shuffle) | ED monsters returned "to deck" → ED face-down instead |
| **Tribute** | Field (own) → GY | Used for Normal Summon Lv5+ or as cost. Pendulum redirect applies |
| **Equip** | Hand → S/T zone, attached to a face-up monster | Equip Spell-specific |
| **Detach** | Xyz overlay material → GY | Pendulum redirect applies; the overlay leaves the "attached" state |
| **Attach** | Field/Hand/GY/Banished → underneath an Xyz Monster as overlay material | Card leaves its zone and becomes an overlay (no longer "on the field") |

### §6.2 Pendulum redirect

**Rule**: when a Pendulum Monster on the field would be sent to the Graveyard, it goes to the **face-up Extra Deck** instead. The redirect happens at the moment of zone transition — the card never reaches the GY.

**Applies when** (source = field zone):
- Pendulum Monster in MZ/EMZ destroyed by battle, by card effect, by being used as material (Fusion/Synchro/Link Materials), tribute summon cost, etc.
- Pendulum Monster in S-zone (used as Pendulum Scale) destroyed.
- Pendulum Monster is detached as Xyz overlay material (the detach destination is normally GY; for Pendulum overlay materials, it becomes ED face-up instead).

**Does NOT apply when**:
- Pendulum Monster sent from HAND to GY (e.g., discarded as cost, hand-cost effects). HAND is not a field zone — the card goes to GY normally.
- Pendulum Monster milled from Main DECK to GY. Same reason.
- Pendulum Monster is banished (going to Banished, not GY).
- Pendulum Monster is returned to Hand or Deck (those are explicit destinations, not GY).

**Effect on triggers** (decisive ruling):
- Triggers that fire on `sent to the GY` or `sent from the field to the GY` (regardless of cause) **do NOT fire** when the redirect activates. The card was redirected — it never reached the GY. Konami ruling: "when a monster on the field is shuffled into the Deck (which includes the Extra Deck), its effects that activate when it 'leaves the field [to GY]' will not activate."
- Triggers that fire on `destroyed` (no destination specified) **DO fire** if the card was destroyed (the destruction event is independent of the destination).
- Triggers that fire on `sent to the GY as material for a Fusion Summon` (or any specific "as material" wording) **do NOT fire** for Pendulum Monsters used as material — the card went to ED, not GY.

**Concrete consequence — Pendulum Dracotail GY-triggers**: a Pendulum Dracotail card with text *"If this card is sent to the GY as material for a Fusion Summon: Set 1 'Dracotail' Spell/Trap from Deck"* **does not fire** if the Dracotail is itself a Pendulum Monster — being sent as Fusion material redirects it to ED face-up, bypassing the trigger condition. Non-Pendulum Dracotail materials trigger normally.

**Override — banish-effect priority**: cards like Macro Cosmos (cardId 30241314) that banish anything that would be sent to the GY take priority over the Pendulum redirect. The Pendulum Monster is **banished face-up** instead of going to the ED.

### §6.3 Extra Deck redirect (ED monsters bounced/returned)

**Rule**: a monster that originally came from the Extra Deck is **always returned to the Extra Deck face-down**, even if a card effect says "return to hand" or "return to deck" or similar.

**Applies to**:
- Fusion / Synchro / Xyz / Link Monsters returned to Hand (Bounce) → go to ED face-down.
- Fusion / Synchro / Xyz / Link Monsters returned to Main Deck → go to ED face-down.
- Pendulum Monsters from face-up ED returned to Hand or Deck — same redirect applies; go to ED.

**Does NOT apply to**:
- ED Monsters sent to GY → go to GY normally (subject to Pendulum redirect for Pendulum Monsters specifically).
- ED Monsters banished → go to Banished normally.

### §6.4 Token vanish

**Rule**: Tokens cannot exist anywhere except the field. When a Token leaves the field, it **vanishes** — it does not go to GY, Hand, Deck, Banished, or any other zone.

**Applies when**:
- Token is destroyed (battle or effect).
- Token is sent to GY by an effect.
- Token is used as Tribute or Material (Fusion/Synchro/Link).
- Token is bounced to Hand or returned to Deck.
- Token is banished.

**Tokens are a distinct card type** (Token Monster) with no effects of their own. They have stats (Name, Attribute, Type, Level, ATK, DEF as defined by the creating effect) but no triggered, ignition, quick, continuous, or flip effects. No Trigger fires from a Token leaving the field, regardless of wording, because the Token has no effect to activate. Triggers on **other cards** that fire from witnessing a Token's destruction or removal (e.g., "When a monster you control is destroyed by battle: ...") fire normally — the witness's effect is independent of whether the destroyed card was a Token.

**Tokens cannot be Xyz Materials** (see §5.7).

### §6.5 GY ordering and inspection

**Rule**: the GY is an **ordered stack**. The top card of the GY (the most recently sent card) is the "top of GY". Some card effects reference the top of GY explicitly (e.g., "Banish the top card of your GY").

- Cards in GY are **public** to both players. Either player can inspect the GY at any time.
- The order can be re-checked (cards are always face-up). No rearranging is allowed unless an effect specifies it.
- "Sent to GY" places the card on top. Multiple cards sent simultaneously — the controlling player chooses the relative order within their own batch.

### §6.6 Banished zone — face-up vs face-down

**Banished face-up**: the standard banish. Both players can see the card. Public information.

**Banished face-down**: some effects banish face-down. Only the owner can see the card. Opponent sees only that "a card is banished face-down".

**Rules**:
- Face-down banished cards are private to the owner. Opponent does not see the card name or text.
- Face-up banished and face-down banished are tracked separately (effectively two sub-piles within the Banished zone for each player).
- Face-down banished cards remain face-down even if returned to the field by an effect (becoming the Set position, typically).

### §6.7 Return-to-hand (Bounce)

**Rule**: a card returned from the Field to the Hand goes to the player's Hand. Standard verb: "return to hand", "shuffle into hand", "bounce".

**Special cases**:
- ED Monsters → ED face-down (see §6.3).
- Tokens → vanish (see §6.4).
- Cards in GY/Banished/Deck cannot generally be "bounced" — bounce is a field-to-hand operation. Some specific effects do explicitly move from non-field zones to hand (those are typically called "add to hand" or "Special Summon to hand" rather than "bounce").

### §6.8 Search / Add to Hand

**Rule**: a card moved from the Main Deck to the Hand by an effect is "searched" or "added to hand".

**Procedure**:
1. The player reveals the chosen card to confirm it matches the search criteria.
2. Add the card to their Hand.
3. **Shuffle the Main Deck** (mandatory after any deck-search).

**Common search criteria**:
- By card name: `"Add 1 [card name] from your Deck to your hand."`
- By archetype: `"Add 1 'Snake-Eye' card from your Deck to your hand."`
- By type: `"Add 1 Spell from your Deck to your hand."`
- By condition: `"Add 1 Level 4 or lower monster from your Deck to your hand."`

**Trigger interactions**:
- "Added from Deck to Hand" Triggers (e.g., Snake-Eye Ash on cardId 9674034: *"If this card is Normal or Special Summoned: You can add 1 Level 1 FIRE monster from your Deck to your hand."*) — searches trigger off "added from the Deck to the hand", which fires both for Normal Search and for Draw Phase draws (some effects distinguish "added except by drawing").
- Maxx "C" / Droll & Lock Bird-class hand traps activate during the response window after a card is added to a hand from the deck.

### §6.9 Excavate / Reveal

**Rule**: an effect that "excavates" reveals the top N cards of the Main Deck without moving them to a zone immediately. Distribution is per the effect's text.

**Procedure**:
1. Reveal the top N cards face-up to both players.
2. Distribute per the effect: typically a subset goes to Hand, the rest to GY or back to Deck.
3. Shuffle Main Deck if any cards were searched-through (i.e., if the effect involved sorting/choosing).

**Example**: Pot of Desires (cardId 35261759):
> *"**Banish 10 cards from the top of your Deck**, face-down; draw 2 cards."*

Pot of Desires is technically a banish-then-draw rather than excavation, but it illustrates a bulk top-of-deck operation. After resolution, no shuffle (the deck order beneath the banished 10 is preserved).

### §6.10 Equip and equip-card lifecycle

**Rule**: an Equip Spell is placed in an empty S/T zone, attached to a face-up monster on the field (the "equipped target"). The Equip Spell's effects apply to the equipped target.

**Lifecycle events that destroy the Equip Spell**:
- The equipped monster leaves the field (destroyed, banished, returned, etc.).
- The equipped monster is flipped face-down.
- The Equip Spell itself is destroyed.

When the Equip Spell is destroyed under any of these conditions, it goes to the GY.

### §6.11 Movement truth table

The following table summarizes which zone-to-zone movements are possible (Y) and which are restricted by special redirects (Y* / Y** / Y***).

| FROM \ TO | MZ | S/T | EMZ | FZ | GY | BN | HAND | MD | ED |
|---|---|---|---|---|---|---|---|---|---|
| HAND | Y | Y | — | Y | Y | Y | (self) | Y | — |
| MZ | Y | Y | Y | — | Y\* | Y | Y\*\* | Y | Y\*\* |
| S/T | Y | Y | — | — | Y\* | Y | Y | Y | — |
| EMZ | Y | — | Y | — | Y\* | Y | Y\*\* | Y | Y\*\* |
| FZ | — | — | — | (self) | Y | Y | Y | Y | — |
| GY | Y | Y | Y | — | (self) | Y | Y | Y | Y |
| BN | Y | Y | Y | — | Y | (self) | Y | Y | Y |
| MD | Y | Y | Y | Y | Y | Y | Y | (self) | — |
| ED | Y | — | Y | — | Y | Y | Y\*\*\* | — | (self) |
| Overlay | — | — | — | — | Y\* | Y | Y | Y | Y\* |

**Legend**:
- `Y` — direct movement allowed.
- `Y*` — Pendulum redirect may apply: Pendulum Monster on field/overlay → ED face-up instead of GY.
- `Y**` — ED redirect: Extra Deck monsters always go to ED face-down instead of Hand or Deck.
- `Y***` — rare; some effects add ED monsters to Hand, but this is unusual (most cards specifically forbid ED-to-Hand).
- `—` — movement not legal under any standard mechanism.
- `(self)` — same-zone moves (no movement).

### §6.12 Xyz overlay state — instance reset rule

When a card is attached as an Xyz overlay material, it leaves its prior zone and enters the **"attached" state** underneath the Xyz Monster. The "attached" state is **not "on the field"** — overlay materials are explicitly outside the on-field set.

**Critical consequence — instance reset**: attaching a card as an overlay material **resets its instance** for the purposes of all lingering effects tied to that specific card instance. The card's identity-tied tracking (lingering buffs/debuffs, "if this card leaves the field" registrations, banish-on-leave clauses, etc.) is reset because the card is no longer on the field — it has become a new "instance" as an overlay material. When detached later (or sent to GY by Xyz destruction), the card is treated as a fresh instance for any subsequent on-field tracking.

**Scope**: this reset applies to **all lingering effects** keyed to the specific card instance, not just banish-on-leave. Examples of effects that get reset:
- Banish-on-leave clauses (e.g., "If this card leaves the field, banish it")
- Lingering buffs/debuffs (e.g., "[X] gains 1000 ATK until the End Phase")
- Lingering negation (e.g., "negate the effects of [X] until the End Phase")
- "If this card leaves the field this turn, [Y]" trackers
- Any Continuous-Effect-applied state targeting that specific monster instance

**Concrete example — banish-on-leave bypass**: a card with text *"If this card leaves the field, banish it"* attached as an Xyz overlay material. The "leaves the field" event happened (the attach), but the resulting state is "attached", not "GY"/"hand"/"banished". The lingering banish-on-leave registration is dropped — the card was tracked while on the field, but the attach reset the tracking. When the overlay material is later detached, it goes to GY without being banished.

**Concrete example — "sent from the field to the GY" trigger bypass**: a card with text *"If this card is sent from the field to the GY: [trigger]"* is attached as an Xyz overlay material, then later detached. The detach goes to GY (or ED face-up if Pendulum, see §6.2). However, **the card was no longer on the field at the time of the detach** — it was in the overlay state. Therefore the trigger condition "sent from the field to the GY" is NOT met. The card was sent from "attached" to GY, not from the field.

**Implication for combo planning**:
- Xyz Materials are a "limbo zone" — cards there have suspended on-field tracking.
- Effects that would trigger from "leaving the field" do not trigger when the card is detached and sent to GY (it left the overlay state, not the field).
- Effects that would trigger from "being destroyed" do trigger if the Xyz Monster is destroyed and the materials go to GY — the destruction is the trigger, not the leave-the-field event.

**Tokens cannot be Xyz Materials** (already noted in §5.7) — this prevents the instance-reset mechanic from being abused with disposable Tokens.

### §6.13 Common LLM pitfalls (state transitions)

1. **Banishing as material does not trigger "sent to GY" effects**. If a card requires "If this card is sent to the GY as material for a Fusion Summon", banishing it instead (e.g., via Albion the Branded Dragon's sub-fusion which banishes) does NOT trigger.
2. **Pendulum Monsters used as Fusion materials with "send to GY" wording**: the Pendulum redirect sends them to face-up ED, NOT to GY. Triggers that fire on `sent to the GY as material for a Fusion Summon` **do NOT fire** for Pendulum Monsters — the card went to ED.
3. **Tokens used as Fusion/Synchro/Link materials vanish**, and Tokens have no effects to trigger anyway. Other cards' effects that fire on "a monster you control is destroyed" or "a monster is sent to the GY by battle" depend on whether the Token actually reached the GY — generally they do NOT (Token vanishes), so witness effects keyed on the Token reaching the GY do not fire either.
4. **Drawing and adding-to-hand are distinct events**. Some Triggers fire on "added from Deck to Hand except by drawing" — they explicitly skip Draw Phase draws but fire on searches.
5. **Discarding from Hand is sending to GY without Pendulum redirect**. Pendulum redirect requires the source zone to be a field zone — HAND is not a field zone, so a Pendulum Monster discarded from hand goes to GY normally.
6. **Detaching an Xyz overlay material is "from attached state to GY"**, NOT "from the field to the GY". Triggers requiring "sent from the field to the GY" do not fire when a card is detached after being attached.

## §7 Zone Topology

This section catalogs the zones on the field and off the field, their capacity, ownership rules, and the Master Rule 5 (April 2020) constraints on Extra Deck summon destinations.

### §7.1 Zone inventory (per player)

**On-field zones**:

| Zone ID | Zone name | Capacity | Card types allowed |
|---|---|---|---|
| MZ1-MZ5 | Main Monster Zones 1-5 | 1 each | Monster cards, Tokens |
| ST1 | Spell/Trap Zone 1 / Pendulum Zone Left | 1 | Spell, Trap, Pendulum Scale (face-up) |
| ST2-ST4 | Spell/Trap Zones 2-4 | 1 each | Spell, Trap |
| ST5 | Spell/Trap Zone 5 / Pendulum Zone Right | 1 | Spell, Trap, Pendulum Scale (face-up) |
| FZ | Field Zone | 1 | Field Spell only |
| EMZ-L | Extra Monster Zone (Left) | 1 | Extra Deck monsters only |
| EMZ-R | Extra Monster Zone (Right) | 1 | Extra Deck monsters only |

**Off-field zones**:

| Zone ID | Zone name | Capacity | Ordering | Visibility |
|---|---|---|---|---|
| HAND | Hand | Unlimited (typically capped at 6 by End Phase) | Ordered (player's choice) | Private to opponent |
| GY | Graveyard | Unlimited | Ordered stack (top matters) | Public — both players see all cards |
| BN | Banished Zone | Unlimited | Unordered (face-up) + separate face-down pile | Face-up: public. Face-down: private to owner |
| MD | Main Deck | 40-60 cards at start | Ordered stack (top matters) | Private — no inspection without card effect |
| ED | Extra Deck | 0-15 cards at start | Face-down (private) + face-up Pendulum sub-pile (public) | Owner sees all; opponent sees face-up only |

### §7.2 Pendulum Zone collapse (Master Rule 5)

**MR5 rule**: Pendulum Zones are NOT separate zones. They are aliases for **ST1 (Left Pendulum / Pendulum Zone Left)** and **ST5 (Right Pendulum / Pendulum Zone Right)**.

**Implications**:
- Placing a Pendulum Monster as a Scale uses ST1 or ST5 — those zones are then unavailable for normal Spell/Trap activation.
- Using both Pendulum Scales (ST1 + ST5 both occupied by Pendulum Monsters) leaves only **3 Spell/Trap zones** available (ST2, ST3, ST4) for activated/set Spells & Traps.
- Pendulum Monsters in ST1/ST5 are face-up; standard Spells/Traps in those same zones are face-up after activation.

### §7.3 Board layout

```
                       [EMZ-L]            [EMZ-R]              [Banish]

[Field]    [MZ1]       [MZ2]    [MZ3]    [MZ4]      [MZ5]      [GY]

[ED]       [ST1/PZL]   [ST2]    [ST3]    [ST4]      [ST5/PZR]  [Deck]

[Controls]                       [HAND]
```

**Spatial adjacency** (relevant for Link Arrows):
- MZ1-MZ5 are in a single row from left to right.
- ST1-ST5 are directly behind MZ1-MZ5 respectively (ST1 below MZ1, ST5 below MZ5).
- EMZ-L is above and between MZ2 and MZ3.
- EMZ-R is above and between MZ3 and MZ4.

### §7.4 Master Rule 5 — Extra Deck summon destinations

**MR5 (April 2020)** loosened the older MR4 restriction that confined Extra Deck summons to a specific Extra Monster Zone. Current rule:

| Extra Deck summon type | Destination |
|---|---|
| Fusion / Synchro / Xyz (non-Pendulum) | Any empty MZ (MZ1-MZ5 or EMZ) — no Link-arrow requirement |
| Link monster | EMZ OR MZ pointed by any Link Monster's arrow (yours or opponent's) |
| Pendulum monster Special Summoned from face-up ED | EMZ OR MZ pointed by any Link Monster's arrow |

**Non-Extra-Deck Special Summons** (Ritual from hand, Reborn-from-GY, Special-Summonable Normal monsters, Pendulum Summon from HAND) are NOT subject to any EMZ/linked restriction — they can land in any empty MZ.

**Strategic note** (skytrix-specific): although Fusion/Synchro/Xyz CAN land in EMZ, competitive play usually routes them to MZ1-MZ5 to keep the EMZ free for a future Link Summon. EMZ is a scarce resource — putting non-Link cards in EMZ blocks Link-ladder plays.

### §7.5 Extra Monster Zone ownership convention

There are **2 EMZ slots physically** (EMZ-L and EMZ-R), shared between both players.

**Ownership rule (MR5)**:
- Each player "owns" at most **one** EMZ at a time — whichever is currently occupied by one of their cards.
- If neither EMZ is occupied, either slot is available to claim on the next Extra Deck summon.
- The other EMZ, once claimed by the opponent, is not accessible to the player except via the Link-arrow fallback (a player-side Link Monster's arrow pointing into a player-side MZ).
- Both players can simultaneously occupy both EMZs (one each).

### §7.6 Link Monster arrow geometry

**8 arrow directions** (an arrow points to a single physical zone):

```
[TL] [T ] [TR]
[L ] [  ] [R ]
[BL] [B ] [BR]
```

**Arrow targets** (from the Link Monster's position, player-0 perspective). EMZ-L sits in column 2 between MZ2 and MZ3; EMZ-R sits in column 4 between MZ3 and MZ4. The MZ row sits in row 3 (player-0 side); the EMZ row sits in row 2 (between rows). Arrows are interpreted on a 3-column-by-3-row grid:

| Position | BL → | B → | BR → | L → | R → |
|---|---|---|---|---|---|
| EMZ-L (col 2, row 2) | MZ2 | MZ3 | MZ3 | (opponent EMZ) | (opponent EMZ) |
| EMZ-R (col 4, row 2) | MZ3 | MZ4 | MZ4 | (opponent EMZ) | (opponent EMZ) |
| MZ1 (col 1, row 3) | off-grid | off-grid | off-grid | off-grid | MZ2 |
| MZ2 (col 2, row 3) | off-grid | off-grid | off-grid | MZ1 | MZ3 |
| MZ3 (col 3, row 3) | off-grid | off-grid | off-grid | MZ2 | MZ4 |
| MZ4 (col 4, row 3) | off-grid | off-grid | off-grid | MZ3 | MZ5 |
| MZ5 (col 5, row 3) | off-grid | off-grid | off-grid | MZ4 | off-grid |

**Top-pointing arrows (T, TL, TR)**: from MZ row (row 3), point upward to row 2 (EMZ row) or to ST zones in the same column. From EMZ row (row 2), top arrows point to opponent's MZ row.

**Note**: arrow targets pointing off the player-0 grid (toward the opponent's row, off the side, or into S-zones) yield no player-0-side MZ slot. The Link summon destination logic only uses the player-0-side MZ/EMZ slots.

**Free-slot decision tree (Extra Deck summon, player 0 perspective)**:

Given a player wants to Extra Deck Summon a monster of category C:

**Branch A — Fusion / Synchro / Xyz (non-Pendulum)**:
1. Scan MZ1..MZ5 and EMZ-L/EMZ-R. If any is empty → summon is legal.
2. If all 7 player-side slots are occupied → summon is blocked (rare; requires a full board).

**Branch B — Link monster, or Pendulum monster from face-up ED**:
1. Is EMZ-L or EMZ-R empty? If yes → summon can land in either available EMZ.
2. Otherwise, scan all face-up Link monsters on the field (both players). For each, compute its arrow targets in grid coordinates. If any arrow targets a player-0-side empty MZ, that zone is available.
3. If neither EMZ nor any linked-MZ is available → the Extra Deck summon is blocked.

### §7.7 Hand size limit

**Rule**: a player's Hand can hold any number of cards mid-turn, but during their **End Phase**, if their Hand contains **more than 6 cards**, they must discard down to 6.

**Implications**:
- Drawing more than 6 cards before End Phase is legal — the discard happens only at End Phase resolution.
- Some cards apply different hand-size limits (e.g., effects that increase or decrease the cap), but the default is 6.

### §7.8 Field Spell zone rules

**Single Field Spell per player**: each player has exactly 1 Field Zone (FZ). When a player activates a new Field Spell, the previous one (if any) is **sent to the GY** (not destroyed — the verb is "sent to the GY", which can matter for triggers).

**Both players can have a Field Spell active simultaneously** (one on each player's FZ).

**Field Spell facing**: Field Spells can be activated face-up (standard) or Set face-down. A Set Field Spell can be flip-activated the same turn it was Set (Field Spells follow the standard Spell timing rule — see §8).

### §7.9 Skytrix FieldState convention (implementation-specific)

In the skytrix solver's `FieldState.zones` representation:
- Both `EMZ_L` and `EMZ_R` are **player-0-relative** — the opponent's EMZs are NOT represented in FieldState.
- An EMZ slot is "free" for the player's next Extra Deck summon iff the corresponding `FieldState.zones.EMZ_L.length === 0 && FieldState.zones.EMZ_R.length === 0` — opponent presence is modeled by hiding the slot rather than by marking it occupied.
- This convention is sufficient for player-0-perspective combo planning. Bilateral modeling would require tracking opponent EMZ occupation separately (deferred to future schema extensions).

### §7.10 Zone capacity violations

**Rule**: a card cannot enter a zone that is already at capacity.

**Implications**:
- A summon attempting to place a monster in a full row (MZ + EMZ) fails — the summon is blocked.
- An effect targeting a destination zone that is full cannot resolve to that zone — the effect either fizzles or rerouted by the effect's text.
- Some cards explicitly interact with zone capacity (e.g., "Special Summon to a zone this card points to" — if no pointed zone is empty, the SS fails).

**Example** (Extra Deck summon blocked):
- Player 0 controls 5 monsters in MZ1-MZ5 + 1 in EMZ-L + 1 in EMZ-R.
- Attempting a Fusion Summon: no empty player-0-side MZ → summon is blocked.
- Attempting a Link Summon using the player-0 monsters as material: legal (the materials are sent to GY first, freeing zones; then the Link Monster lands in a now-empty zone).

## §8 Set Timing Rules (per card type)

This section catalogs which Spell/Trap card types can be activated on the same turn they are Set face-down, and which must wait until a subsequent turn. The distinction is a frequent source of LLM misreasoning.

### §8.1 Same-turn flip-activation table

| Card type | Set this turn → activate this turn? | Rationale |
|---|---|---|
| **Normal Spell** | YES | No Set-this-turn restriction; standard Spell timing applies |
| **Continuous Spell** | YES | Same as Normal Spell |
| **Equip Spell** | YES | Same as Normal Spell |
| **Field Spell** | YES | Same as Normal Spell |
| **Ritual Spell** | YES | Same as Normal Spell |
| **Quick-Play Spell** | **NO** | Specific Quick-Play restriction: a Set Quick-Play cannot flip-activate the same turn it was Set |
| **Normal Trap** | **NO** | Generic Trap restriction: Set Traps cannot activate on the turn they were Set |
| **Continuous Trap** | **NO** | Same as Normal Trap |
| **Counter Trap** | **NO** | Same as Normal Trap |

**Summary**: only Quick-Play Spells and all Trap variants are subject to the "must wait" restriction. All other Spell types can be Set and flip-activated within the same turn.

### §8.2 Activation-from-hand vs flip-activation distinctions

The Set-this-turn rule applies only to **flip-activation** of a Set face-down card. Activating a Spell directly **from the Hand** is independent — it has its own timing rules per Spell type:

| Card type | Activate from Hand on own turn | Activate from Hand on opponent's turn |
|---|---|---|
| Normal Spell | YES (Main Phase 1 or 2) | NO |
| Continuous Spell | YES (Main Phase 1 or 2) | NO |
| Equip Spell | YES (Main Phase 1 or 2) | NO |
| Field Spell | YES (Main Phase 1 or 2) | NO |
| Ritual Spell | YES (Main Phase 1 or 2) | NO |
| Quick-Play Spell | YES (any phase of own turn) | **NO** (Quick-Play from hand is restricted to own turn) |
| Normal Trap / Continuous / Counter | N/A (Traps cannot be activated from hand) | N/A |

**Key implication**: Quick-Play Spells in hand can be activated on the player's own turn at SS2 timing — a flexible response window beyond what Normal Spells offer. But on the opponent's turn, a Quick-Play in hand is dead — it can only be activated face-up Set on the opponent's turn (and only after at least one full turn has passed since the Set).

### §8.3 Trap timing nuances

**General rule**: a Trap card must be Set on the field at the start of the activating player's turn (i.e., the Set was performed on a previous turn, and the Trap has been face-down since).

**Specific cases**:
- A Trap Set during the active player's own turn cannot activate that turn — the activation window opens at the next turn (the opponent's turn).
- A Trap Set during the opponent's turn (e.g., by an effect like "Set this Trap from your Deck") cannot activate that opponent's turn — it must wait until the activating player's next turn or beyond.

**Example sequence** (Normal Trap):
- Turn 1 (Player A): A Sets Mirror Force.
- Turn 1 (Player A) End Phase: Mirror Force still face-down.
- Turn 2 (Player B): Mirror Force is now eligible to be activated by Player A in response to Player B's actions.

### §8.4 Quick-Play same-turn restriction — concrete example

**Scenario**: Player A activates a card effect that lets them Set a Quick-Play Spell from the Deck during Main Phase 1.

- The Quick-Play is now face-down in a S/T zone.
- For the rest of Player A's turn, this Quick-Play **cannot be flip-activated**.
- It becomes activatable starting from Player B's turn (any phase) or any subsequent turn.

This is identical timing to Trap activation — Set Quick-Plays behave like Traps for the purposes of the Set-this-turn restriction.

### §8.5 Common LLM pitfalls (Set timing)

1. **Conflating Quick-Play with Normal Spell for Set timing**: a common error is assuming "all Spells can be Set and activated same turn". WRONG — only non-Quick-Play Spells can.
2. **Assuming Set Spells of any type wait until next turn**: WRONG — Normal/Continuous/Equip/Field/Ritual Spells Set this turn CAN be activated this turn (this is rarely useful but legal).
3. **Forgetting Quick-Play in hand can be activated on own turn**: a Quick-Play in hand is fully usable during the player's own turn at SS2. The "must wait" rule only applies to face-down Set Quick-Plays.
4. **Confusing Set Quick-Play with Set Trap on opponent's turn**: both behave the same after the Set — must wait at least one turn. But a Quick-Play in hand activated directly on the player's own turn doesn't wait.

## §9 Counters, Tokens, and Xyz Materials

This section consolidates three special card-state mechanics that affect game state but exist outside the standard zone topology.

### §9.1 Counters

**Definition**: a counter is a named marker placed on a face-up card on the field. Counter types are named (e.g., "Spell Counter", "Heart Counter", "Mist Counter") and tracked separately per type.

**Rules**:
- Counters exist **only on face-up cards on the field**. Removed when:
  - The card leaves the field (destroyed, banished, returned to hand/deck, etc.)
  - The card is flipped face-down (e.g., by a Flip-to-Defense effect)
- Multiple counter types can coexist on a single card.
- A card can hold many counters of the same type (no per-card cap unless specified).
- Counters are public information — both players can inspect counter counts on either side at any time.

**Counter manipulation by effects**:
- Adding counters: typically wording like "place 1 [Type] Counter on [target]".
- Removing counters: "remove 1 [Type] Counter from [target]" (for cost or as effect).
- Counter-conditional effects: "If [card] has 3 or more [Type] Counters, [effect]."

**Example types of counters** (illustrative, not exhaustive):
- Spell Counter (Endymion archetype)
- Mist Counter (Mist Valley)
- Magnet Counter (Magnet Warriors)
- Bushido Counter (Six Samurai)

**Counter behavior on zone transition**: counters do not transfer with the card by default. A monster bounced to hand and re-summoned arrives with 0 counters. Some specific card effects can transfer counters between cards (verification on a per-effect basis required — read the oracle text).

### §9.2 Tokens

**Definition**: a Token Monster is a card-substitute placeholder created by an effect, with stats defined by the creating effect.

See §6.4 for the full Token rules. Summary:
- Tokens are a distinct card type (Token Monster) with no effects of their own.
- Tokens exist **only on the field**. They vanish when leaving the field — never reach GY, Hand, Deck, Banished, or any other zone.
- Tokens CAN be used as Tribute, Fusion Material, Synchro Material, Link Material.
- Tokens **CANNOT** be Xyz Materials.
- Tokens cannot be Set face-down.
- Tokens cannot be returned to a hand or deck — they vanish if a bounce/return effect targets them.

**Common token-creation effects**:
- "Special Summon 1 Sheep Token (FAIRY/EARTH/Lv1/0/0) to your field."
- "Special Summon 2 Predaplant Tokens (PLANT/DARK/Lv1/0/0) in Defense Position."

**Token zone**: Tokens occupy a Main Monster Zone (or EMZ if specified) just like a regular monster. They count toward the 5-MZ limit.

### §9.3 Xyz Materials (overlay materials)

**Definition**: Xyz Materials are cards attached underneath an Xyz Monster, used as resources for the Xyz Monster's effects (typically detached as a cost).

See §5.7 (Xyz Summon procedure), §6.12 (instance reset rule), and §9.3 below for details.

#### §9.3.1 Material status

- Xyz Materials are **NOT on the field** — they exist in a special "attached" state.
- They have no position, no Level/Rank/Attribute/Type effects, and their own effects are not active while attached.
- They cannot be targeted by effects targeting "cards on the field".
- They cannot be destroyed by battle, by destruction effects targeting field cards, or by any effect that requires "on the field" as a precondition.
- They are public information (the Xyz Monster's controller can inspect, the opponent can inspect).

#### §9.3.2 Detaching

A common Xyz cost: "detach 1 Xyz Material from this card". Mechanism:

1. The Xyz Monster's controller chooses which material to detach (when multiple are present).
2. The chosen material goes from "attached" to GY.
3. **Pendulum redirect applies** if the detached material is a Pendulum Monster — it goes to face-up ED instead of GY (see §6.2).
4. The Xyz Monster remains on the field even with 0 materials (unless an effect specifies destruction-on-zero-materials).

**Critical** — detaching is "from attached state to GY", NOT "from the field to GY". Triggers requiring "sent from the field to the GY" do NOT fire when a card is detached after being attached (see §6.12).

#### §9.3.3 Attaching by card effect

Some effects attach cards to an Xyz Monster as new materials (after the Xyz Summon). Sources can include:
- Field (a face-up monster being attached as material — leaves the field)
- GY (a card from GY attached, no longer "in the GY")
- Hand (a card from hand attached, no longer "in the hand")
- Deck (rare)
- Banished (rare)

When a card is attached:
- It leaves its prior zone.
- It enters the "attached" state under the target Xyz Monster.
- **Instance reset applies** (see §6.12) — all lingering effects keyed to the specific card instance are dropped.

#### §9.3.4 Xyz Monster leaving field

When the Xyz Monster itself leaves the field:
- All remaining attached materials are sent to GY simultaneously.
- Pendulum redirect applies per material (Pendulum materials → ED face-up).
- Materials do NOT follow the Xyz Monster to its new destination (e.g., if the Xyz Monster is bounced to hand, materials are sent to GY anyway).

#### §9.3.5 Xyz Evolution (Rank-Up)

An Xyz Monster can itself be used as Xyz Material for another Xyz Summon. Procedure:

1. The original Xyz Monster + any attached materials all become materials of the new Xyz Monster.
2. The "stack" is preserved — all materials transfer to the new Xyz, plus the original Xyz Monster itself.
3. The new Xyz Monster is Special Summoned in the original's zone (or another empty MZ depending on the effect).

**Example**: a Rank-3 Xyz Monster with 2 materials is Rank-Up'd into a Rank-4 Xyz Monster. The new Rank-4 Xyz has 3 materials underneath: the original 2 materials + the original Rank-3 Xyz Monster.

#### §9.3.6 Tokens cannot be Xyz Materials

This is the only summon-mechanic restriction unique to Xyz. Tokens explicitly cannot be Xyz Materials, regardless of effect wording. If a Token would be required as material (e.g., chosen by mistake), the Xyz Summon fails.

**Rationale**: Tokens vanish when leaving the field — they cannot exist outside the on-field state (see §6.4). The Xyz overlay state is "attached" (not on the field, not in any other zone), which is incompatible with the Token's vanish-on-leave semantics. Similarly, Tokens cannot be banished face-down for the same reason — face-down banished requires a tracked off-field state, which Tokens cannot occupy.

## Annexe A — Common LLM pitfalls

Frequent reasoning errors. Each entry: pitfall → rule reference. Use this annex as a self-check after forming a hypothesis.

| # | Pitfall | Correct rule (§) |
|---|---|---|
| A.1 | "Set Spells must wait until next turn to activate." | Only Quick-Play Spells set this turn must wait. Normal/Continuous/Equip/Field/Ritual can flip-activate same turn. (§8.1) |
| A.2 | "OPT clauses always limit across all copies." | 6 OPT variants exist. Soft OPT is per-instance. Activate-OPT is lenient (negation doesn't spend quota). Parse the exact wording. (§3.1) |
| A.3 | "A `this turn` lock only applies after the activating card resolves." | `this turn` / `the turn you activate this card` apply to the entire turn including before activation. If restricted action already occurred, activation is illegal. (§2.4) |
| A.4 | "A Pendulum Monster sent to GY as material triggers GY-effects normally." | Pendulum Monsters from field zones redirect to ED face-up, never reaching GY. `sent to the GY` triggers do NOT fire. (§6.2) |
| A.5 | "Detaching an Xyz overlay material triggers `from the field to the GY` effects." | Overlay materials are NOT on the field. Detach is "attached → GY", not "field → GY". Such triggers do NOT fire. (§6.12) |
| A.6 | "Destroying the source card removes its already-applied lingering effect." | Lingering Effects, once applied, cannot be negated. Source removal does not undo them. (§2.3) |
| A.7 | "All Special Summons can be negated by activation-negation cards." | Summoning Conditions (no `:` no `;`) are not effect activations and create no chain link. Effect-negation cards (Effect Veiler) cannot stop them. Summon-negation cards (Solemn Judgment, Solemn Strike) CAN. (§2.5) |
| A.8 | "Connected sub-effects resolve independently." | `then` / `and if you do` make B fail if A fails. Standalone `and` is all-or-nothing. Only `also` / `also, after that,` are independent. (§1.3) |
| A.9 | "Trigger Effects always fire when conditions are met." | `When` triggers can miss timing if the event is buried mid-chain. `If` triggers never miss timing. (§1.7) |
| A.10 | "I can decline any Trigger Effect." | Mandatory Triggers (no `you can`) fire automatically. Only Optional Triggers (`you can`) are player choice. (§1.8) |
| A.11 | "I can chain my own Quick Effect ahead of the inactive player's mandatory Trigger." | SEGOC class precedence: Mandatory Triggers > Optional Triggers > Quick Effects. Inactive's Mandatory enters the chain before active's Optional or Quick. (§4.7) |
| A.12 | "Tokens reaching the GY trigger 'sent to GY' effects on other cards." | Tokens vanish when leaving the field — they never reach GY. Witness effects keyed on the Token's GY arrival do not fire. (§6.4) |
| A.13 | "An effect that destroys a card also triggers `sent to GY` effects." | Banishing or other non-GY destinations do not trigger `sent to GY` effects. Match the verb in the trigger condition exactly. (§6.13) |
| A.14 | "Drawing and adding-to-hand are interchangeable for triggers." | Some triggers fire on `added from Deck to Hand except by drawing` — they explicitly skip Draw Phase but fire on searches. Read the wording. (§6.13) |

### A.15 Methodological discipline

When reasoning about a combo ceiling or about whether an effect can be activated:

1. **Verify rules from this document, not from memory.** If a rule is missing or ambiguous, report the gap as feedback — do not guess.
2. **Trust empirical results.** If `replay-trajectory-cli` reports a divergence, your plan has a bug, not the engine. Investigate the divergence step-by-step.
3. **Enumerate exhaustively before claiming a ceiling.** List every Spell/Trap/Monster in the deck that could contribute. Document each card's role or an explicit elimination reason. Missing a non-obvious enabler is a frequent cause of false ceilings.
4. **Quote the oracle text when applying a rule.** Do not paraphrase — the exact wording (`When` vs `If`, `target` presence, OPT clause) is what determines the ruling.

## Annexe B — Working with `replay-trajectory-cli`

The verification tool for Path β plans. Submitting a plan to the OCG engine and inspecting its output is the only authoritative way to confirm whether a plan reaches the expected board.

### B.1 Invocation

```bash
cd duel-server
npx tsx scripts/replay-trajectory-cli.ts \
  --fixture-id=<FIXTURE_ID> \
  --plan-file=<path-to-plan.json> \
  --out=<path-to-result.json>
```

Optional flags:
- `--dump-trace=<path>` — JSONL trace of every prompt the engine emitted, with the picked response and the `pickSource` (plan / target / auto / raw / auto-end-phase).
- `--use-hints` — applies plan-level hints; default OFF.

### B.2 Output schema

```json
{
  "fixtureId": "<FIXTURE_ID>",
  "expectedBoardSize": 8,
  "matched": 7,
  "matchedCardIds": [...],
  "missingCardIds": [...],
  "score": 70,
  "scoreBreakdown": {...},
  "stoppedReason": "completed | divergence | exception | ceiling",
  "stoppedAtPlanStep": 5 | null,
  "divergence": null | { "step", "promptType", "expected", "legalActionsAtPrompt": [...] },
  "replayLog": [...],
  "finalBoardSelf": [...]
}
```

### B.3 Interpreting `stoppedReason`

| Value | Meaning | What to do |
|---|---|---|
| `completed` | Plan executed to End Phase, all steps consumed. The reported `matched` and `score` reflect the final board. | If `matched < target`, your plan is incomplete — different decomposition needed. |
| `divergence` | At plan step N, the engine surfaced a prompt where no plan-step `cardName` / `responseIndex` matched any legal action. Engine state diverged from your plan's expectation. | Read `divergence.legalActionsAtPrompt` to see what the engine actually offered. Common causes: (a) plan referenced a card not yet in the right zone, (b) wrong `verb` for the available action, (c) a previous step put the engine in an unexpected state, (d) prompt is a sub-prompt (SELECT_CARD/SELECT_PLACE) requiring a `targets[]` entry the plan didn't provide. |
| `exception` | The engine threw — typically an invalid-state error (e.g., trying to summon to a full board, activating a card not on field). | Treat as divergence and inspect. |
| `ceiling` | Plan-replay ceiling hit (rare): resolver returned a response without `chosenAction`. Usually an internal bug or unsupported prompt type. | Report the prompt type encountered. |

### B.4 Interpreting `divergence`

When `stoppedReason === "divergence"`, the `divergence` object contains:
- `step`: the index into your plan where the divergence occurred.
- `promptType`: the prompt type the engine emitted (`SELECT_IDLECMD`, `SELECT_CARD`, `SELECT_PLACE`, etc.).
- `expected`: the action your plan-step described in human-readable form.
- `legalActionsAtPrompt`: the list of legal actions the engine actually offered. Each entry has `{ responseIndex, cardId, cardName, verb }`.

**Diagnostic checklist when divergence occurs**:
1. Compare your plan-step's `cardName` and `verb` against `legalActionsAtPrompt`. Is the card present? Is the verb correct?
2. If the card is absent, check the `replayLog` for steps before the divergence — what zones contain the card now? Was it consumed/sent to GY/banished by an earlier step's side effect?
3. If the prompt is a sub-prompt (`SELECT_CARD`, `SELECT_PLACE`, `SELECT_POSITION`, `SELECT_TRIBUTE`, `SELECT_UNSELECT_CARD`), check whether your plan-step has a `targets[]` array providing the right hint. Sub-prompts after an IDLECMD step consume targets in order (see B.7).
4. If the engine is asking for something your plan didn't anticipate (e.g., a Trigger you didn't account for), the prior plan-step's side effect surfaced an unexpected event. Add a `chainTargets[]` entry on the previous step or restructure.

### B.5 Interpreting `replayLog`

The `replayLog` is a chronological record of every prompt the engine emitted and how it was resolved. Each entry:

```json
{
  "step": 7,
  "promptType": "SELECT_CHAIN",
  "applied": "Dracotail Mululu (chain) [chainTarget]",
  "appliedCardId": 7375867,
  "appliedResponseIndex": 0,
  "planStepIndex": 2
}
```

- `step` — sequential index across the entire replay.
- `promptType` — what the engine asked for.
- `applied` — human-readable description of what was picked, with the `[source]` tag indicating where the response came from:
  - `[plan]` — matched a plan-step's main action.
  - `[target]` — matched a `targets[]` entry on a plan-step.
  - `[chainTarget]` — matched a `chainTargets[]` entry on a plan-step.
  - `[auto]` — auto-resolved via `MechanicalDefaultOracle` (default for sub-prompts not explicitly hinted).
  - `[raw]` — matched via raw responseIndex (β-3 trajectory mode).
  - `[auto-end-phase]` — auto-passed at end of plan when `endTurn: true`.
- `planStepIndex` — which plan-step this prompt was associated with, or `null` if auto-resolved between plan-steps.

**Reading the replayLog to debug**:
- Trace forward from step 0. Each `[plan]` entry advances the plan-step pointer. `[auto]` entries reveal what default the engine took for sub-prompts.
- A common bug pattern: plan-step uses `cardName: "X"` and the engine surfaces multiple legal actions matching "X" with different `verb`s (e.g., `normal-summon`, `set-monster`, `activate`). The plan-step matches the FIRST. If the wrong verb was picked, add a `verb` field to the plan-step.
- Sub-prompt auto-resolves are the silent failure mode: if a `SELECT_PLACE` auto-picks zone seq 0 when you wanted seq 4, the divergence won't surface until much later (when the wrong-zone card blocks a subsequent action). Use `targets[]` with `promptHint` and `cardName` (or zone-specific overrides) to pin the choice.

### B.6 Plan grammar reference

```jsonc
{
  "plan": [
    {
      "cardName": "<substring, case-insensitive>",
      "verb": "activate | normal-summon | set-st | summon-procedure | set-monster | tribute-summon | end-phase",
      "sourceZone": "<optional zone disambiguator: M1-M5, S1-S5, EMZ_L, EMZ_R, HAND, GY, BANISHED, FZONE, PZONE, or aliases MZONE/SZONE>",
      "responseIndex": 3,  // optional: pin by raw legal-action index, bypasses cardName/verb/sourceZone matching
      "targets": [
        { "promptHint": "<human description>", "cardName": "<sub-prompt target>" },
        { "promptHint": "...", "cardNames": ["<option-A>", "<option-B>"] },
        { "promptHint": "...", "responseIndex": 3 }
      ],
      "chainTargets": [
        { "promptHint": "<human description>", "cardName": "<chain link target>" }
      ]
    }
  ],
  "endTurn": true
}
```

**Field semantics**:
- `cardName` — case-insensitive **bidirectional** substring match against the legal-action's cardName. The match is `legal.includes(hint) || hint.includes(legal)` — your hint matches if either contains the other as a substring. Multiple legal matches → first picked. Required unless `responseIndex` is set on the step.
- `verb` — disambiguates multiple legal actions with the same cardName. Optional. Use when the same card has multiple valid `verbs` at the same prompt.
- `sourceZone` — disambiguates same-cardName same-verb legal actions that differ by source zone (e.g., King's Sarcophagus copy in HAND vs in S1, both surface as `activate`). Accepts exact zone IDs (M1-M5, S1-S5, EMZ_L, EMZ_R, HAND, GY, BANISHED, FZONE, PZONE) or zone-family aliases: `SZONE` matches S1-S5/FZONE/PZONE; `MZONE` matches M1-M5/EMZ_L/EMZ_R. Optional.
- `responseIndex` — pin the action by its raw legal-action list index. **Bypasses cardName, verb, and sourceZone matching entirely**. Use when cardName is ambiguous (e.g., for `to_bp` / `to_ep` end-phase actions which have cardId 0) or when no other field disambiguates. When set, all other matching fields on the step are ignored.
- `targets[]` — consumed at SELECT_CARD/PLACE/POSITION/UNSELECT/TRIBUTE/SUM sub-prompts that follow this plan-step's main action, in order, until the next IDLECMD.
- `chainTargets[]` — consumed at SELECT_CHAIN sub-prompts. Default behavior when absent: pass at every SELECT_CHAIN. Provide a `chainTargets[]` entry to activate a specific Trigger on the chain.

**Targets sub-prompt grammar**:
- `{cardName: "X"}` — single target match against ONE prompt (typically `SELECT_CARD` with min=1).
- `{cardNames: [A, B]}` — single target with **multiple acceptable names**, still matches ONE prompt. The first legal action matching ANY of the listed names is picked. Useful when the engine offers a flexible choice and the plan accepts several alternatives.
- For multi-pick prompts (`SELECT_CARD` min>1, `SELECT_TRIBUTE`, `SELECT_SUM`, multi-material `SELECT_UNSELECT_CARD`), provide N separate target entries, each matching ONE selection. `cardNames: [...]` is NOT equivalent to N separate entries — it's still one entry with options.

**`responseIndex: -1`** terminates a `SELECT_UNSELECT_CARD` selection (sends `index: null`). Use as the (N+1)th target entry on multi-material Link/Xyz Summons after providing N material entries.

**Substring matching pitfall**: when a target card's name contains another card's name as a substring (e.g., `Welcome Labrynth` is a substring of `Big Welcome Labrynth`), using `cardName: "Welcome"` matches the FIRST legal action whose name contains "Welcome" — possibly the wrong card. Use the **unique discriminator** (e.g., `cardName: "Big Welcome"` to specifically match Big Welcome Labrynth) to avoid silent mis-matches.

**Trigger Effects do NOT need their own IDLECMD `(activate)` plan-step**. Cards with on-Summon, on-SS, on-NS, or on-GY-send Trigger Effects auto-resolve in the post-event Trigger window via SEGOC (§4.7). The plan should only include IDLECMD steps for **player-initiated activations** (Ignition Effects, Spell/Trap activations, Quick Effects you choose to activate). Adding a redundant `(activate)` plan-step for an auto-firing Trigger Effect causes divergence — the engine has already resolved the trigger, so the card no longer surfaces in legal actions at the next IDLECMD.

**Concrete example of the trigger-redundancy trap**: a plan that summons monster X (which has an on-Summon search trigger) and then has a separate plan-step `{cardName: "X", verb: "activate"}` will diverge at that step — X's search trigger already auto-fired in the SEGOC window after the summon, and X cannot be re-activated. Drop the redundant step; the search target goes via the `targets[]` of the summon plan-step (or via `chainTargets[]` if the trigger surfaced on a chain).

### B.7 Auto-defaults at sub-prompts

When a plan-step has no explicit `targets[]` entry for a sub-prompt, the engine auto-resolves with these defaults (from `MechanicalDefaultOracle`). The "Override" column shows the syntax in `targets[]` (or `chainTargets[]` for SELECT_CHAIN).

| Prompt type | Default response | Pickable via `targets[]`? | Override syntax |
|---|---|---|---|
| `SELECT_CARD` (single) | First legal index | YES | `{cardName: "X"}` or `{responseIndex: N}` |
| `SELECT_CARD` (min N>1) | First N legal indices | YES | `{cardNames: ["A","B"]}` or `{responseIndex: N}` |
| `SELECT_OPTION` | First option | YES | `{responseIndex: N}` |
| `SELECT_PLACE` | First empty zone (lowest seq) | YES | `{responseIndex: N}` (N is the zone index in the legal list) |
| `SELECT_POSITION` | Face-up Attack | YES | `{responseIndex: N}` |
| `SELECT_UNSELECT_CARD` | `index: 0` (NOT null even when `can_finish=true`) | YES | `{responseIndex: -1}` for null/finish, `{responseIndex: N}` for specific pick |
| `SELECT_TRIBUTE` | First N legal indices | YES | `{cardNames: [...]}` or `{responseIndex: N}` |
| `SELECT_SUM` | First min legal indices | YES | `{cardNames: [...]}` or `{responseIndex: N}` |
| `SELECT_CHAIN` | Pass (`responseIndex: -1`) | via `chainTargets[]` | `{cardName: "X"}` to activate a Trigger; absent = pass |
| `SELECT_EFFECTYN` | Yes (`responseIndex: 1`) | YES (via `targets[]`) | `{responseIndex: 0}` for NO, `{responseIndex: 1}` for YES |
| `SELECT_YESNO` | No (`responseIndex: 0`) | YES (via `targets[]`) | `{responseIndex: 0}` for NO, `{responseIndex: 1}` for YES |
| `SELECT_COUNTER` | All zeroes | NO | (not in `SUB_PROMPT_PICKABLE`; falls through to `MechanicalDefaultOracle`) |
| `ANNOUNCE_NUMBER` | Last index of `options[]` (= max value) | **NO** | Not overridable in β-1. Falls through to `MechanicalDefaultOracle`. |
| `ANNOUNCE_RACE / ATTRIB / CARD` | first option (default) | NO | not in pickable set |

**Critical implications**:

1. **ANNOUNCE_NUMBER is NOT overridable in β-1.** The default picks the LAST option in `options[]` (= maximum value offered). For effects like Lance Soldier's level-up (where the canonical line picks a non-max value), this default is wrong and there is no plan-grammar mechanism to override it.

2. **SELECT_EFFECTYN / SELECT_YESNO override exists** via `targets[]`. Default for EFFECTYN is YES (responseIndex 1), default for YESNO is NO (responseIndex 0). Use `{responseIndex: 0}` or `{responseIndex: 1}` explicitly to override.

   **Common silent-failure pattern**: optional revive/SS prompts of the form *"You can target … Special Summon it"* or *"You can pay X; activate"* on Continuous Spells/Traps consistently surface as **SELECT_YESNO with default NO**. If your plan needs the optional clause to fire, you MUST add an override entry. Concrete example — a Continuous Trap with text *"...if you do, you can target 1 monster in your GY; Special Summon it"* surfaces a SELECT_YESNO after the activation; without `targets: [{responseIndex: 1}]`, the auto-default picks NO and the SS clause silently doesn't fire. The plan completes successfully but with one fewer monster on the board than expected. This is the dominant silent-failure mode of plans that "should work" — always check the replayLog for `[auto]` resolutions on SELECT_YESNO when a plan completes with `matched < expected`.

3. **SELECT_PLACE / SELECT_POSITION override is via `responseIndex`**, not by zone name. The `responseIndex` corresponds to the index in `legalActionsAtPrompt`. Inspect the engine's legal list (via `--dump-trace`) to find the right index for the zone you want.

4. **`targets[]` matching by `cardName`** uses bidirectional substring matching (case-insensitive). When multiple legal actions share the same name (common for SELECT_EFFECTYN where both responseIndex 0 and 1 carry the same cardId), the FIRST match wins — typically responseIndex 0. For yes/no override, ALWAYS use `{responseIndex: ...}` explicitly.

If your plan diverges and `replayLog` shows `[auto]` resolutions for a sub-prompt that mattered (e.g., an `ANNOUNCE_NUMBER` value, a `SELECT_PLACE` zone), the auto-default may have differed from what your plan needed. Read the `replayLog` step where the auto fired and trace the engine's subsequent state. For ANNOUNCE_NUMBER specifically, the override gap is a known limitation — report it as feedback if it blocks your plan.

### B.7.1 SELECT_UNSELECT_CARD `can_finish=true` does NOT auto-terminate

The auto-default for `SELECT_UNSELECT_CARD` picks `index: 0` (the first legal index) even when `can_finish=true`. It does NOT return `null`. Multi-material Link/Xyz Summons that surface as a sequence of `SELECT_UNSELECT_CARD` prompts therefore loop infinitely OR pick wrong materials unless the plan explicitly provides a finish marker.

**Pattern**: when a Link or Xyz Summon needs N materials, provide N+1 target entries. The first N specify the materials by `cardName`; the (N+1)th uses `{responseIndex: -1}` to terminate the selection.

**Example** — Link 2 Summon using 2 specific monsters from field, with explicit finish:
```jsonc
{
  "cardName": "Accesscode Talker",
  "verb": "summon-procedure",
  "targets": [
    { "promptHint": "material 1", "cardName": "I:P Masquerena" },
    { "promptHint": "material 2", "cardName": "Cross-Sheep" },
    { "promptHint": "finish", "responseIndex": -1 }
  ]
}
```

### B.7.2 SELECT_OPTION for "no-tribute" Lv7+ summons requires explicit override

Cards like Kashtira Birth that allow the controller to Special Summon a Lv7+ monster without tributes surface a `SELECT_OPTION` after the IDLECMD activation, asking which mode (no-tribute SS vs normal tribute summon). The auto-default picks index 0 (the first option), which is typically the tribute-summon mode → triggers a follow-up `SELECT_TRIBUTE` that loops infinitely if the player has no monsters to tribute.

**Pattern**: when activating a card that grants no-tribute summons, override the SELECT_OPTION with `responseIndex: 1` (or whichever index represents the no-tribute mode). Inspect the legal-action list via `--dump-trace` to confirm.

### B.7.3 S:P Little Knight banish trigger auto-targets first card on field

When S:P Little Knight is summoned, its banish-trigger surfaces a `SELECT_CARD` asking which face-up card to banish. The auto-default picks index 0 — typically the just-summoned monster on field, causing silent self-sabotage (you banish a piece you needed for the endboard).

**Pattern**: explicitly target a GY card or unwanted opponent card via the `targets[]` of the S:P summon plan-step.

### B.7.4 `tribute-summon` verb scope

The `verb: "tribute-summon"` covers ALL Lv5+ Normal-Summon-class actions, including Lv7+ no-tribute SSes granted by effects (e.g., Kashtira Birth's bypass). It is NOT restricted to actual tribute-cost summons. `verb: "normal-summon"` is reserved for Lv1-4 monsters with no tribute cost.

### B.7.5 Continuous Spells with cost-gated effects need TWO activate plan-steps

A Continuous Spell with a "flip-and-then-pay-cost" effect pattern (e.g., Deception of the Sinful Spoils) requires two distinct plan-steps:

1. First `activate` step → flips the card face-up. Effect e0 (the activation itself) resolves.
2. Second `activate` step → fires effect e1 (the cost-gated ignition).

The reason: the engine treats the first activation (face-up flip) and the secondary cost-paid effect as separate IDLECMD activations, NOT as a chained sub-effect of the first.

### B.7.6 mechanicalOverrides[] — pin specific values on auto-respond sub-prompts

Some sub-prompts are NOT surfaced to the plan via `targets[]`/`chainTargets[]` because they are auto-resolved internally by the adapter. The β-1 v2 grammar exposes these via the optional top-level `mechanicalOverrides[]` field:

- **SELECT_PLACE** (zone string: `M1`-`M5`, `EMZ_L`, `EMZ_R`, `S1`-`S5`, `FZ`)
- **SELECT_POSITION** (`FACEUP_ATTACK` | `FACEUP_DEFENSE` | `FACEDOWN_DEFENSE`)
- **ANNOUNCE_NUMBER** (literal `value` — e.g. Lance Soldier level 1-4)
- **SELECT_OPTION** (`responseIndex` into the option list)
- **SELECT_TRIBUTE** (`responseIndex` — pins one tribute index; remaining slots fill in OCG order)

#### Schema

```jsonc
{
  "plan": [...],
  "mechanicalOverrides": [
    {
      "after": "Lance Soldier activate",          // case-insensitive substring on lastIdlecmdDesc
      "promptType": "ANNOUNCE_NUMBER",
      "value": 2
    },
    {
      "after": "I:P Masquerena summon-procedure",
      "promptType": "SELECT_PLACE",
      "zone": "S5"
    }
  ],
  "endTurn": true
}
```

#### Matching semantics

- **`after`**: substring match (case-insensitive) against `lastIdlecmdDesc`, which is updated to `"<cardName> <verb>"` on every IDLECMD pick. The override fires ONLY between that IDLECMD and the next IDLECMD.
- **`promptType`**: exact match.
- **FIFO consumption**: each override is consumed at most once; multiple sharing the same `after` fire in array order.
- **Skip-on-invalid**: when an override matches but its value is unavailable (zone blocked, value not in options[], etc.), the override is consumed and the adapter falls back to its default. Logged as `[override-skipped]` in `replayLog`.
- **Soft warning**: unconsumed overrides at end of replay surface as `[override-skipped] never matched (after="...")` in `replayLog` — not a fail.

#### When to use it

Use `mechanicalOverrides[]` when `targets[]`/`chainTargets[]` cannot reach the prompt:

- **ANNOUNCE_NUMBER**: never surfaces to the plan; use override to pin level-up values (D/D Lance Soldier, Pendulum scale picks).
- **SELECT_POSITION**: rarely surfaces; use override to flip a summon to defense (Sphinx-style passive walls).
- **SELECT_PLACE**: surfaces only when EMZ available OR 2-4 main zones free. For trivial single-slot SELECT_PLACE (Link 1 to fixed EMZ), use override to pin EMZ_L vs EMZ_R when arrows matter.
- **SELECT_OPTION**: surfaces but `targets[]` already supports `responseIndex`. The override path is preferred when the choice is mechanical-not-strategic (e.g. summon-from-hand vs summon-from-field for a card with both Lua effect choices).
- **SELECT_TRIBUTE**: surfaces only when `selects[]` non-empty. Use override to pin the tribute target index.

#### Caveats

- **Late-firing prompts**: when ANNOUNCE_NUMBER fires AFTER the IDLECMD that "caused" it (e.g. during end-phase chain resolution), target the most-recent IDLECMD instead — typically `"end-phase"`.
- **Debug**: set `SOLVER_DEBUG_OVERRIDES=1` to dump `[overrides-debug] findMatch promptType=... ctx=... queue=N` for every hook call. Confirms the `lastIdlecmdDesc` shape at each prompt site.

### B.8 Workflow when plan stalls below target

1. Run the plan; observe `matched`, `score`, `stoppedReason`.
2. If `stoppedReason === "completed"` but `matched < target`: the plan executed cleanly but produced the wrong board. Hypothesize a different decomposition — different starter card, different fusion enabler, different sequencing.
3. If `stoppedReason === "divergence"`: read `divergence` + `replayLog`. Identify the failing step. Apply the diagnostic checklist (B.4).
4. Iterate. Record each attempt in your CoT log (see prompt template) with the hypothesis and the result.
5. After ≤15 attempts or convergence at a plateau: write a final summary documenting the highest matched achieved and the unverified assumptions remaining.
