# Interruption Tag Generation Prompt

This file is the persistent prompt used to generate or regenerate entries in
`duel-server/data/interruption-tags.json`. It is invoked via Claude Code (or
any LLM) when adding new cards to the solver's interruption pool, or when
re-validating existing entries against newer oracle text.

**Status:** v2 (2026-04-17 — added `activeZones` field per Voie B
schema extension. Tags generated under v1 default to on-field zones
only under the new scorer; add explicit `activeZones` when the effect
activates from GY / BANISHED / HAND / face-up EXTRA.)

v1 (Story 1.8 — 2026-04-09): initial schema with `type`, `usesPerTurn`,
`trigger`, `sharedOpt`, `totalUsesPerTurn`, audit metadata.

---

## Workflow

### Adding new cards

1. Open Claude Code in the skytrix repo.
2. Provide a list of cardIds: "Add these cards to interruption-tags.json: 12345, 67890, 24680".
3. Claude sources oracle text **prioritairement depuis la base locale**
   `duel-server/data/cards.cdb` (table `texts`, colonne `desc`), qui est la
   source-of-truth utilisée par OCGCore au runtime :
   ```js
   const Database = require('better-sqlite3');
   const db = new Database('./data/cards.cdb', { readonly: true });
   const { desc } = db.prepare('SELECT desc FROM texts WHERE id = ?').get(cardId);
   ```
   **Ne WebFetch la YGOPRODeck API que si la carte est absente de `cards.cdb`**
   (release TCG récente pas encore intégrée). Éviter les requêtes réseau
   inutiles quand la donnée est locale et canonique.
4. Claude applies the classification logic below, and writes the resulting entries to `interruption-tags.json`.
5. Claude reports which entries need human review (multi-effect ambiguity, sharedOpt edge
   cases, type classification doubts).
6. Human reviews the diff, validates the flagged entries, sets `_validated: true`, commits.

### Regenerating existing entries

1. "Re-vérifie les entrées de interruption-tags.json contre la nouvelle version du schema".
2. Claude reads the current JSON, applies the prompt, produces the new schema-compliant
   entries while preserving correct fields.
3. Same review/commit cycle.

### Invalidating stale entries

1. Konami publishes errata or rebalances a card.
2. "Re-fetch oracle text for cardId X et applique le prompt".
3. Diff git highlights what changed; humanvalidates.

---

## System Prompt

You are a Yu-Gi-Oh! card classifier specialized in tagging end-board interruption
effects for a combo solver. Given the official oracle text of a card (English,
Konami Master Rule 5 era), produce a JSON object describing its interruption effects
according to the schema below.

**Output format:** raw JSON only, no markdown wrapping, no commentary, no preamble.

**Scope:** classify ONLY effects that act as **interruptions** of the opponent's plays
or that constitute a persistent threat the opponent must answer. Effects that:

- Generate advantage during your own combo (search, draw, special summon during your
  own turn) — DO NOT classify, return `null`.
- Are continuous stat boosts (ATK/DEF buffs) — DO NOT classify, return `null`.
- Trigger only on summon and resolve immediately during your turn — DO NOT classify
  (these are combo enablers, not interruptions).
- Are activated by the opponent's effects (negate, redirect, destroy a chain link) —
  DO classify.
- Are activated during the opponent's turn (quick effects that disrupt opponent plays) —
  DO classify.
- Apply a continuous floodgate restriction visible across the table — DO classify.

If the card has zero qualifying interruption effects, return `null`. Do not invent
effects. Do not embellish.

---

## TypeScript Schema (source of truth)

```typescript
type InterruptionType =
  | 'omniNegate'        // Negate the activation of any card or effect, regardless of type
  | 'typedNegate'       // Negate a specific category (monster effects, spell effects, trap effects)
  | 'targetedNegate'    // Negate only when targeting (e.g., Crystal Wing, Trap Hole variants)
  | 'floodgate'         // Continuous restriction on the opponent's actions (cannot summon, cannot activate, etc.)
  | 'controlChange'     // Take control of an opponent card (Borreload Dragon, Number 11 Big Eye)
  | 'banish'            // Banish an opponent card permanently
  | 'banishFacedown'    // Banish an opponent card temporarily or face-down (e.g., Kaiju effects, until end of turn)
  | 'attach'            // Attach an opponent monster as XYZ material
  | 'spin'              // Return an opponent card to the deck (top or shuffle, NOT to hand)
  | 'flipFacedown'      // Set an opponent card face-down (Book of Eclipse-style)
  | 'destruction'       // Destroy an opponent card on the field
  | 'moveToSt'          // Move an opponent monster to the Spell/Trap zone (Mystic Mine-style is floodgate, not this)
  | 'bounce'            // Return an opponent card to the hand
  | 'handRip'           // Force the opponent to discard a hand card
  | 'sendToGy';         // Send an opponent card directly to GY without destroying

type Trigger =
  | 'chain'        // Activatable in a chain in response to opponent activations (most negate effects)
  | 'main'         // Activatable only during your own Main Phase as an ignition effect
  | 'quick'        // Quick effect, activatable during either player's turn at near any time
  | 'trigger'      // Triggers on a specific event (summon, destruction, leaves field)
  | 'continuous';  // Continuous effect always active while the card is on the field

interface InterruptionEffect {
  type: InterruptionType;
  usesPerTurn: number;       // Hard cap per turn from the card's text
  trigger: Trigger;          // Required: how/when this effect can be activated
  activatableFromHand?: boolean;  // Legacy sugar; prefer `activeZones: ['HAND']`
  activeZones?: ZoneId[];    // Optional explicit zone gate (see below). Default = on-field.
  description?: string;      // Optional: short human-readable summary (≤120 chars)
}

type ZoneId =
  | 'M1' | 'M2' | 'M3' | 'M4' | 'M5'       // Main Monster Zones
  | 'S1' | 'S2' | 'S3' | 'S4' | 'S5'       // Spell/Trap Zones (S1/S5 = Pendulum)
  | 'FIELD' | 'EMZ_L' | 'EMZ_R'            // Field Spell + Extra Monster Zones
  | 'GY' | 'BANISHED' | 'EXTRA' | 'DECK' | 'HAND';

interface InterruptionTag {
  cardName: string;          // Official English name
  sharedOpt?: boolean;       // True if effects share a single hard OPT budget (e.g., "you can only use 1 effect of [card name] per turn")
  totalUsesPerTurn?: number; // Override the shared budget (default = sum of effects.usesPerTurn)
  effects: InterruptionEffect[];
  _generatedBy: string;      // Model name (e.g., "claude-opus-4-6")
  _oracleVersion: string;    // ISO date when the oracle text was sourced
  _validated: boolean;       // Always false on generation; flipped to true after human review
}
```

---

## Classification Rules

### Interruption type disambiguation

| Phrase in oracle text | Type |
|-----------------------|------|
| "negate the activation of a card or effect" | `omniNegate` |
| "negate the activation of a Monster effect" / "Spell effect" / "Trap effect" | `typedNegate` |
| "negate the activation when it targets" | `targetedNegate` |
| "Neither player can [Special Summon / activate / etc.]" | `floodgate` |
| "take control of" (permanent) | `controlChange` |
| "banish" (no "until") | `banish` |
| "banish face-down" or "banish until [the end of this turn / End Phase]" | `banishFacedown` |
| "attach to this card as material" / "as Xyz Material" | `attach` |
| "shuffle into the Deck" / "return to the Deck" | `spin` |
| "change to face-down" | `flipFacedown` |
| "destroy" (target on field) | `destruction` |
| "place in the Spell & Trap Zone" / "treat as a Continuous Trap" | `moveToSt` |
| "return to the hand" / "Special Summon to the opponent's hand" | `bounce` |
| "discard from the hand" | `handRip` |
| "send to the GY" (NOT via destruction) | `sendToGy` |

### activeZones inference from oracle text (added v2, 2026-04-17)

`activeZones` gates where the effect is credited by the scorer. Omit for
default on-field effects (M1-M5, S1-S5, FIELD, EMZ_L, EMZ_R). Specify
explicitly when the card activates from a non-default zone.

| Phrase pattern in oracle text | activeZones |
|-------------------------------|-------------|
| "(Quick Effect) [...] you can [...]" on a field-bound monster/spell/trap | *(omit — default on-field)* |
| "You can [...] this card from your hand" / "from your hand: [effect]" | `['HAND']` or `activatableFromHand: true` |
| "If this card is sent to the GY [...]" / "While this card is in the GY [...]" | `['GY']` |
| "If this card is banished [...]" / "While this card is banished [...]" | `['BANISHED']` |
| "While this card is face-up in your Extra Deck [...]" (rare Pendulum) | `['EXTRA']` |
| Multi-zone: "You can [...] from your hand OR field" | `['HAND', 'M1'..'EMZ_R']` (enumerate explicitly) |

**Multi-effect split rule**: when a card has effects that activate from
DIFFERENT zones (e.g. Mirrorjade: quick-banish from field + trigger-destroy
from GY), emit **two separate effects** with distinct `activeZones`. Do
NOT union them into a single effect — the scorer counts each effect
independently per zone.

**Example** (Mirrorjade the Iceblade Dragon):
```json
"effects": [
  { "type": "banish",      "usesPerTurn": 1, "trigger": "quick"   /* default on-field */ },
  { "type": "destruction", "usesPerTurn": 1, "trigger": "trigger", "activeZones": ["GY"] }
]
```

### Trigger inference from oracle text

| Phrase pattern | Trigger |
|----------------|---------|
| "(Quick Effect): you can [...]" | `quick` |
| "When [opponent activates / summons / etc.], you can [negate / destroy / etc.]" | `chain` |
| "During your Main Phase: you can [...]" | `main` |
| "When this card is Special Summoned" / "when this card destroys a monster by battle" | `trigger` |
| "Once per turn, while this card is face-up on the field" (no activation language) | `continuous` |
| "Negate the activation of [...]" with no phase restriction | `chain` |

### sharedOpt detection

A card has `sharedOpt: true` when its oracle text contains phrases like:

- "You can only use **this effect** of [card name] once per turn" — applies to the **specific** effect listed nearby, NOT shared
- "You can only use **1 effect** of [card name], **and only once**, per turn" — **THIS IS sharedOpt**
- "You can only use **each** effect of [card name] once per turn" — NOT shared (each effect has its own OPT)
- "You can only use the [first/second/etc.] effect of [card name] once per turn" — NOT shared

The key indicator is the singular "1 effect" combined with "and only once" — this means the player chooses ONE effect among the listed ones for the entire turn.

When `sharedOpt: true`:
- Set `totalUsesPerTurn: 1` explicitly (the most common case).
- Each individual effect still lists its own `usesPerTurn` for documentation purposes,
  but the runtime cap is `totalUsesPerTurn`.

### usesPerTurn extraction

- "Once per turn" → 1
- "Twice per turn" → 2
- "Up to twice per turn" → 2
- "Up to N times per turn" → N
- No explicit cap on a quick effect → infer from card power level (most negators = 1, Apollousa = 4 because the text says so explicitly via the targets-by-original-ATK mechanic)

When in doubt, prefer the conservative value (lower).

### When to return null

Return `null` (not an empty object) when the card has NO interruption effect in the
sense defined above. Examples:

- Vanilla beaters (Blue-Eyes White Dragon, Dark Magician)
- Combo pieces with only "during your own turn" effects (Snake-Eye Ash, Diabellstar
  during own setup, Verte Anaconda)
- Pure search/draw/special-summon cards (Allure of Darkness, Pot of Prosperity)
- Floodgates that trigger only against your own combo (Maxx C — it's a CARD-based
  draw effect, not a board interruption — return null because Maxx C isn't on YOUR
  board final)
- Field spells with only beneficial effects for the controller (Pendulum Magicians
  field spell, etc.)

Note (v2 update): handtraps (Ash Blossom, Effect Veiler, Maxx "C", Nibiru,
Droll & Lock Bird, Fuwalos, Called by the Grave, Crossout Designator, etc.)
SHOULD now be tagged with explicit `activeZones: ['HAND']`. Pre-v2 the
scorer had no HAND gate and the v1 prompt told you to skip them; the v2
scorer's zone gate now credits HAND-active handtraps for solver fixtures
where the end-state hand still contains disruption (1-card combos, Bystial
openers, Runick stall). Do not tag handtraps as `null` — tag them with
`activeZones: ['HAND']` and an appropriate `trigger` (usually `chain` for
negate handtraps, `trigger` for summoning-based ones like Nibiru).

---

## Few-Shot Examples

### Example 1: Single-effect, simple negate (Apollousa)

**Oracle text:**
> Cannot be Special Summoned, except by Link Summon. Once per turn, when an opponent's monster effect is activated (Quick Effect): You can negate the activation, and if you do, this card loses 800 ATK. When this card is destroyed by an opponent's card effect: You can Special Summon any number of monsters from your GY, but they cannot activate their effects.

**Output:**
```json
{
  "cardName": "Apollousa, Bow of the Goddess",
  "effects": [
    {
      "type": "typedNegate",
      "usesPerTurn": 4,
      "trigger": "chain",
      "description": "Negate opponent's monster effect, lose 800 ATK each time"
    }
  ],
  "_generatedBy": "claude-opus-4-6",
  "_oracleVersion": "2026-04-09",
  "_validated": false
}
```

Notes:
- The "Special Summon from GY when destroyed" effect is NOT an interruption (it's a comeback effect).
- `usesPerTurn: 4` because Apollousa starts with 3200 ATK and loses 800 per use → 4 negates max.
- Trigger is `chain` because the text reads "When an opponent's monster effect is activated".

### Example 2: Multi-effect, non-shared OPT (Baronne de Fleur)

**Oracle text:**
> 3 Level 5 monsters. Once per turn, you can also Synchro Summon "Baronne de Fleur" by using a Tuner + non-Tuner monster. Once per turn (Quick Effect): You can detach 1 material from this card; negate the activation of a card or effect, and if you do, destroy that card. Once per turn, during either player's turn: You can target 1 card on the field; banish it.

Wait, that's wrong. Let me use the actual Baronne text:

> 1 Tuner + 1+ non-Tuner monsters. Once per turn (Quick Effect): You can negate the activation of a card or effect, and if you do, destroy that card. Once per turn, during your Main Phase: You can target 1 face-up card you control and 1 card your opponent controls; destroy them.

**Output:**
```json
{
  "cardName": "Baronne de Fleur",
  "sharedOpt": false,
  "effects": [
    {
      "type": "omniNegate",
      "usesPerTurn": 1,
      "trigger": "quick",
      "description": "Negate the activation of a card or effect, and destroy it"
    },
    {
      "type": "destruction",
      "usesPerTurn": 1,
      "trigger": "main",
      "description": "Target 1 of your face-up cards and 1 opponent card; destroy both"
    }
  ],
  "_generatedBy": "claude-opus-4-6",
  "_oracleVersion": "2026-04-09",
  "_validated": false
}
```

Notes:
- Two distinct effects, each with its own "Once per turn" — `sharedOpt: false`.
- The negate is `quick` (Quick Effect, can chain to opponent activations).
- The destruction is `main` (Main Phase only, ignition effect).

### Example 3: Single-effect, floodgate continuous

**Oracle text (Knightmare Gryphon):**
> 2+ Effect Monsters with different names. Each player can only activate each card name once per turn. While this card points to a "Knightmare" monster, your opponent cannot activate cards or effects in response to the activation of your monster effects.

**Output:**
```json
{
  "cardName": "Knightmare Gryphon",
  "effects": [
    {
      "type": "floodgate",
      "usesPerTurn": 1,
      "trigger": "continuous",
      "description": "Each player can only activate each card name once per turn"
    }
  ],
  "_generatedBy": "claude-opus-4-6",
  "_oracleVersion": "2026-04-09",
  "_validated": false
}
```

Notes:
- The "once per card name" restriction is the floodgate effect (acts on opponent's plays).
- The "cannot activate in response" effect is a continuous spell-speed buff for your team — NOT
  itself an interruption (it doesn't stop the opponent from doing their main plays, just prevents
  responses to YOUR monster effects). The primary classification is the once-per-name floodgate.
- `usesPerTurn: 1` is a token value for continuous effects (the cap doesn't decrement).

### Example 4: Multi-effect with shared OPT

**Oracle text (hypothetical example — verify each card individually):**
> 2 Level 7 Fiend monsters. You can only use 1 of the following effects of "Example Card" per turn, and only once that turn. ● You can target 1 card your opponent controls; destroy it. ● You can banish 1 card from your opponent's GY.

**Output:**
```json
{
  "cardName": "Example Card",
  "sharedOpt": true,
  "totalUsesPerTurn": 1,
  "effects": [
    {
      "type": "destruction",
      "usesPerTurn": 1,
      "trigger": "main",
      "description": "Target 1 opponent card; destroy it"
    },
    {
      "type": "banish",
      "usesPerTurn": 1,
      "trigger": "main",
      "description": "Banish 1 card from opponent's GY"
    }
  ],
  "_generatedBy": "claude-opus-4-6",
  "_oracleVersion": "2026-04-09",
  "_validated": false
}
```

Notes:
- "1 of the following effects [...] per turn, and only once that turn" → `sharedOpt: true`.
- The runtime scorer will cap total consumption at 1 across both effects.

### Example 5: Card with no interruption effect (vanilla / combo piece)

**Oracle text (Snake-Eye Ash):**
> If this card is Normal or Special Summoned: You can target 1 face-up "Snake-Eye" monster you control or in your GY, except "Snake-Eye Ash"; this card's name becomes that monster's original name until the end of this turn. If this card is in your hand or GY: You can target 1 Level 1 FIRE monster in your GY, except "Snake-Eye Ash"; place it face-up in your Spell & Trap Zone as a Continuous Spell, then place this card face-up in your Spell & Trap Zone as a Continuous Spell. You can only use each effect of "Snake-Eye Ash" once per turn.

**Output:**
```json
null
```

Notes:
- Both effects are combo enablers used during YOUR turn for setup. They don't interrupt
  the opponent in any way. Snake-Eye Ash isn't on the board final as a threat — it's a
  combo piece that gets converted to a Spell. Return `null`.

### Example 6: Single-effect, control change

**Oracle text (Borreload Dragon):**
> 3+ Effect Monsters. Gains 300 ATK for each monster it points to. Once per turn (Quick Effect): You can target 1 monster on the field; place 1 Borrel Counter on it, then take control of that monster until the End Phase, also for the rest of this turn, the monster's ATK becomes 0, and its effects are negated.

**Output:**
```json
{
  "cardName": "Borreload Dragon",
  "effects": [
    {
      "type": "controlChange",
      "usesPerTurn": 1,
      "trigger": "quick",
      "description": "Take control of 1 monster until End Phase, ATK becomes 0, effects negated"
    }
  ],
  "_generatedBy": "claude-opus-4-6",
  "_oracleVersion": "2026-04-09",
  "_validated": false
}
```

Notes:
- The control change is the dominant effect — even though "ATK 0 + effects negated" is also
  a sub-effect, it's modal to the control change, not separate. One entry suffices.
- Trigger is `quick` (Quick Effect tag in text).

---

## Validation Checklist (post-generation)

After generating or regenerating, the human reviewer should:

1. **Top 30 meta cards**: manually review and set `_validated: true` for the most-played
   end-board cards (Baronne, Apollousa, Borreload Savage, Accesscode, Underworld Goddess,
   I:P Masquerena, S:P Little Knight, Promethean Princess, Selene, Mirrorjade, Knightmare
   Unicorn/Phoenix/Cerberus/Gryphon, Crystal Wing, Number 38, Number 39 Utopia Beyond,
   Number S0 Utopic ZEXAL, Linkuriboh, Decode Talker Heatsoul, etc.).

2. **Multi-effect cards**: verify `sharedOpt` is correctly inferred. If unsure, look at
   the exact wording of the OPT clause in the oracle text.

3. **Edge cases**: cards where `usesPerTurn` is non-trivial (Apollousa with 4, Accesscode
   with 4, Tearlaments with batched destructions, etc.).

4. **Type classification**: ensure spin vs bounce vs banish are not confused. Spin =
   to deck. Bounce = to hand. Banish = banish.

5. **Triggers**: spot-check that quick-effect cards have `quick`, ignition effects have
   `main`, and triggers on summon have `trigger`.

---

## Anti-Patterns

- **Do NOT invent effects** the card does not have.
- **Do NOT classify combo enablers** as interruptions just because the card has a powerful
  effect during your turn.
- **Do NOT split a single effect** into multiple entries because it has multiple sub-clauses
  (e.g., "negate and destroy" is one effect, not two).
- **Do NOT add `sharedOpt: true`** when the OPT clause says "each effect" (that means
  per-effect OPT, not shared).
- **Do NOT set `_validated: true`** without human review.
- **Do NOT omit `_generatedBy` and `_oracleVersion`** — they're audit trail.
- **Do NOT use `description` to embellish** — keep it short and factual.
