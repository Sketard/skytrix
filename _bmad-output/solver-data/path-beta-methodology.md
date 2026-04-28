# Path β — Méthodologie & Playbook

**Pour Axel.** Ce fichier est un **playbook actionnable** pour reprendre Path β à n'importe quel moment, avec les commandes exactes, le mental model, et les pièges à éviter. Lis ça quand tu reprends le solver après une pause.

---

## TL;DR — qu'est-ce que Path β

**Path β = Claude Code subagent dispatché sur une CLI de replay OCG itérative. $0 API. Délivre des lifts mesurables sur les fixtures.**

Pipeline :
1. CLI Node prépare le contexte fixture (deck, hand, expectedBoard avec noms)
2. Subagent (modèle Opus-class via Claude Code) reçoit ce contexte + outils CLI + game rules
3. Subagent itère : draft un plan → replay sur OCG WASM → lit le résultat (matched, divergence, replay log) → corrige → re-replay
4. ~5-15 itérations, 100K-200K tokens, ~10-15 min wall par fixture
5. Output : plan optimal + verdict structuré

**Deux modes** :
- **β-1 (from-scratch)** : subagent compose un plan haut-niveau `[{cardName, verb, targets[], chainTargets[]}, ...]` depuis zéro. Pour fixtures sans authored canonical line.
- **β-3 (improve authored)** : subagent prend une trajectoire authored existante au format raw `[{responseIndex, cardId}, ...]` et corrige les bugs/extensions manquantes. Plus rapide, plus high-ROI, mais limité aux 4 fixtures avec authored lines.

---

## Quand utiliser Path β

| Situation | Décision |
|---|---|
| Tu veux pousser une fixture au-delà du DFS baseline | **β-1 v2 (chainTargets)** depuis zéro |
| La fixture a déjà un authored canonical line dans `_bmad-output/planning-artifacts/research/trajectories/` | **β-3** d'abord (audit le recording), puis β-1 si plus de lift possible |
| Tu veux mesurer l'honest baseline (sans fixture-leak) | `SOLVER_DISABLE_EXPERTISE=1 SOLVER_DISABLE_PREFERRED=1` sur l'eval canonical |
| Le rate limit subscription est hit | Attends ~1h reset, OU bascule sur API direct (`@anthropic-ai/sdk` déjà installé, ~$10-30/fixture) |

---

## Setup une fois pour toutes (déjà fait, ne pas re-runner)

Les CLIs sont déjà shippées (commit `2ae96064`). Vérifier :

```bash
cd duel-server
ls scripts/get-card-info.ts scripts/dump-fixture-context.ts scripts/replay-trajectory-cli.ts
# si tout est là, tu es bon
```

Dépendances déjà présentes : `@anthropic-ai/sdk`, `zod`, `better-sqlite3`. `npm install` si node_modules manquant.

---

## Workflow concret pour un audit fixture

### Étape 1 — Pré-extraire le contexte fixture

```bash
cd duel-server
npx tsx scripts/dump-fixture-context.ts \
  --fixture-id=<FIXTURE_ID> \
  --out-dir=data/path-beta-poc/<FIXTURE_ID>
```

Crée `data/path-beta-poc/<FIXTURE_ID>/fixture.json` avec le deck + hand + expectedBoard tous nommés. Le subagent lira ça en premier.

**Liste des fixture-ids disponibles** : voir `_bmad-output/planning-artifacts/research/solver-validation-decks.json` champ `hands[].id`. Les 14 du canonical eval :
- branded-dracotail-opener
- branded-dracotail-opener-mirrorjade-line
- ddd-pendulum-opener
- ryzeal-mitsurugi-opener
- radiant-typhoon-opener
- snake-eye-yummy-opener
- horus-crystron-opener
- kashtira-azamina-opener
- dinomorphia-opener
- spright-opener
- floowandereeze-opener
- labrynth-opener
- stun-runick-opener
- nekroz-ryzeal-opener
- tearlaments-opener

### Étape 2 — Choisir le mode

**Si la fixture a un authored canonical line dans `_bmad-output/planning-artifacts/research/trajectories/`** (par convention `<FIXTURE_ID>-recorded.json` ou `<FIXTURE_ID>.json`) → **β-3** d'abord.

**Sinon** → **β-1 v2** directement.

### Étape 3a — Dispatch β-3 (improve authored)

Dispatcher un subagent **`general-purpose`** avec un prompt structuré (template à la fin de ce fichier). Le subagent :
1. Replay l'authored line as-is → baseline
2. Identifie les bugs (typically : SELECT_CHAIN auto-pass sur des triggers GY, ou stale responseIndex après évolution moteur)
3. Corrige et itère

Output attendu :
- `data/path-beta-poc/<FIXTURE_ID>/beta3-baseline.json` (replay original)
- `data/path-beta-poc/<FIXTURE_ID>/beta3-best-trajectory.json` (corrigé)
- `data/path-beta-poc/<FIXTURE_ID>/beta3-best-result.json`

### Étape 3b — Dispatch β-1 v2 (from-scratch)

Subagent compose un plan depuis zéro avec `targets[]` et `chainTargets[]`.

Output attendu :
- `data/path-beta-poc/<FIXTURE_ID>/beta1v2-best-plan.json`
- `data/path-beta-poc/<FIXTURE_ID>/beta1v2-best-result.json`

### Étape 4 — Vérifier mécaniquement

```bash
npx tsx scripts/replay-trajectory-cli.ts \
  --fixture-id=<FIXTURE_ID> \
  --plan-file=data/path-beta-poc/<FIXTURE_ID>/beta1v2-best-plan.json \
  --out=/tmp/verify.json
grep -E '"matched":|"score":|"stoppedReason":' /tmp/verify.json
```

Si `matched` ≥ DFS baseline + 1 → lift confirmé. Sinon, plateau ou bug.

---

## Grammar plan format (β-1)

```jsonc
{
  "plan": [
    {
      "cardName": "Branded Fusion",
      "verb": "activate",
      "targets": [
        // Consommés en ordre aux SELECT_CARD/OPTION/PLACE/UNSELECT/TRIBUTE/SUM/POSITION
        // qui suivent immédiatement l'IDLECMD step jusqu'au prochain IDLECMD.
        { "promptHint": "fusion target", "cardName": "Lubellion the Searing Dragon" },
        { "promptHint": "fusion materials", "cardNames": ["Fallen of the White Dragon", "Dracotail Phryxul"] }
      ],
      "chainTargets": [
        // Consommés en ordre aux SELECT_CHAIN qui suivent.
        // Sans chainTargets, défaut = pass à chaque SELECT_CHAIN.
        { "promptHint": "Mululu GY trigger", "cardName": "Dracotail Mululu" }
      ]
    },
    {
      "cardName": "Dracotail Lukias",
      "verb": "normal-summon"
    }
  ],
  "endTurn": true
}
```

**Verbes valides** : `activate`, `normal-summon`, `set-st`, `summon-procedure`, `set-monster`, `tribute-summon`, `end-phase`.

**Match** : `cardName` est case-insensitive substring. Multiple acceptable via `cardNames: [...]`. Override par index brut via `responseIndex: N`.

**Défauts auto-pick** (si pas de target) :
- SELECT_CHAIN → pass (`responseIndex === -1`)
- SELECT_EFFECTYN → YES (`responseIndex === 1`)
- Tout autre sub-prompt → `legal[0]`

---

## Grammar raw trajectory format (β-3)

```jsonc
{
  "fixtureId": "branded-dracotail-opener",
  "steps": [
    { "responseIndex": 1, "cardId": 73819701, "cardName": "Fallen of the White Dragon" },
    { "responseIndex": -1, "cardId": 0, "cardName": "" },
    { "responseIndex": 1, "cardId": 73819701, "cardName": "Fallen of the White Dragon" }
  ]
}
```

Chaque step est appliqué verbatim. Si un step ne match pas (typically prompt SELECT_PLACE inattendu), le CLI auto-resolve le sub-prompt SANS consommer le step → continue. Divergence stoppe seulement si mismatch à un SELECT_IDLECMD.

Le format `{trajectory: [...]}` est aussi accepté (utilisé par les dumps de `evaluate-structural.ts --dump-trajectories`).

---

## Honest baseline & fixture-leak

**Lecture critique** : le DFS baseline 26/69 inclut un fixture-leak via `preferredSearchTargets` (sourcé de `expectedBoard` cardIds). C'est un proxy d'authoring humain qu'on a longtemps confondu avec capability solver.

**Mesurer l'honest baseline** :
```bash
cd duel-server
SOLVER_DISABLE_EXPERTISE=1 SOLVER_DISABLE_PREFERRED=1 SOLVER_USE_NEURAL_WEIGHTS=1 \
  npx tsx scripts/evaluate-structural.ts \
    --budget-ms=6000 --node-budget=400 --pool-size=4 --implicit-goals=10 \
    --label=honest-baseline \
    --out=data/eval-arch-c/honest-no-preferred.json \
    --compare=data/eval-arch-c/control.json
```

**Reference** :
- DFS canonical (avec leak) : 26/69 cum matched, score 523
- DFS honest (sans leak) : **22/69 cum matched, score 452**

Toute amélioration future doit être comparée à 22/69, pas à 26/69.

---

## Hardcoded constraints à savoir

Critique trouvée dans `src/solver/ocgcore-adapter.ts` et `solver-types.ts` :

| Constraint | Where | Impact |
|---|---|---|
| `EXPLORATORY_PROMPTS` ⊃ {IDLECMD, BATTLECMD, CHAIN, EFFECTYN, YESNO, OPTION} only | `solver-types.ts:89` | Tout le reste auto-resolved par défaut |
| `SELECT_CARD_EXPLORATORY_MAX = 6` | `ocgcore-adapter.ts:894` | Above 6 candidates → pas de DFS branch |
| `SELECT_CARD_PREFERRED_EXPOSURE_K = 4` | idem | Top-4 préférés exposés sinon auto-resolve |
| `SELECT_POSITION = FACEUP_ATTACK` | `ocgcore-adapter.ts:1575` | DFS jamais set/face-down stratégique |
| `preferredSearchTargets ← expectedBoard` | `evaluate-structural.ts:518` | **Pure leak — gateable via SOLVER_DISABLE_PREFERRED=1** |
| autoRespondMechanical : SELECT_CARD picks first `min` indices | `ocgcore-adapter.ts:1638` | Sans preferred, pure aléatoire |
| autoRespondOpponent : always pass | `ocgcore-adapter.ts:1657` | Goldfish-only |

Ces hardcodings expliquent pourquoi Stage 3a/3b/Arch C ont nullé — ils biasaient SELECT_IDLECMD ranking, pas la couche bottleneck (SELECT_CARD auto-resolve).

---

## Pièges et incidents observés

1. **Format incompatible** : `snake-eye-yummy-opener.raw-replay.json` est en format PvP-replay, pas `{steps:[...]}`. Skipper ou convertir manuellement.
2. **Drift de recording** : authored lines plus vieilles que les binding patches OCG ont des responseIndex obsolètes. Le subagent les détecte et corrige (cf. mitsurugi β-3).
3. **Rate limit subscription** : ~700K tokens cum / heure semble être la limite. Reset hourly. Pour 14-fix complet : sequential, ~1-2 days wall.
4. **Path Windows** : `/tmp/...` ne marche pas (Windows resolve différemment). Utilise `data/...` paths relatifs.
5. **bash cwd ne persiste pas** entre tool calls : utilise `cd duel-server && ...` chained, ou paths absolus.

---

## Prompt template pour dispatcher un subagent

```
You are a Yu-Gi-Oh combo solver running Path β-{1 OR 3} on `<FIXTURE_ID>`.

Working directory: `C:\Users\Axel\Desktop\code\skytrix\duel-server` — `cd` there before any Bash command.

[Pour β-3 : Background paragraph describing the GY-trigger-pass pattern + ceiling-refutation pattern observed on prior fixtures.]

Mission: <fixture-id>. Read `data/path-beta-poc/<FIXTURE_ID>/fixture.json` to understand hand/deck/expectedBoard. Current solver baseline at honest config: ~X/Y matched. Stretch target: 7/8 or beyond.

Tools:
1. `npx tsx scripts/get-card-info.ts <cardId> --json` for oracle/catalog/lua paths.
2. `Read` for catalog/Lua paths returned.
3. Game rules at `../_bmad-output/planning-artifacts/yugioh-game-rules.md`.
4. `npx tsx scripts/replay-trajectory-cli.ts --fixture-id=<FIXTURE_ID> --plan-file=<path> --out=<result-path>`.
5. [β-3 only] Authored line at `../_bmad-output/planning-artifacts/research/trajectories/<FIXTURE_ID>.json`.

Grammar (β-1): `{plan: [{cardName, verb, targets?, chainTargets?}], endTurn}`.
Grammar (β-3): `{fixtureId, steps: [{responseIndex, cardId}]}` (raw trajectory).

Sub-prompt defaults: SELECT_CHAIN→pass, SELECT_EFFECTYN→YES, others→legal[0]. Override via targets/chainTargets.

Constraints: 15 attempts max, no source-file modifications, save best as <appropriate path>.

Final report: structured matched/score/iterations/missing-card-analysis/key-insights.

Begin.
```

Adapter selon mode β-1 vs β-3. Voir mes dispatches précédents (en historique de conversations) pour des templates exacts.

---

## Critic-mode prompt — mandatory skip-card analysis (R2, Sprint 1 refinement)

**Why this section exists.** When a critic LLM is dispatched on a fixture
that plateaus, it tends to fall into a "use-everything bias": the implicit
framing is *"given all hand cards, what's the optimal activation order?"*
rather than *"which hand cards are productive vs which are dead weight?"*.
This bias produced the branded 7/8 critic verdict ("8/8 mechanically
impossible") which actually meant *"8/8 impossible IF you activate every
hand card"* — but the canonical 8/8 line might NOT activate one of them
(e.g. Branded Fusion's ED-Fusion lock blocks downstream Synchros).

**Mandatory section in every critic prompt** (insert before the workflow
phase):

```
## Mandatory skip-card analysis (DO BEFORE AUTHORING)

Before drafting any plan, generate a skip table for each hand card:

| Hand card | Activated → enables | Skipped → preserves | Lock cost if activated |
|-----------|---------------------|---------------------|------------------------|

For each card, answer in 1 line each column. The "Lock cost" column is
critical — many YGO cards impose constraints when activated (ED locks,
attribute locks, position locks, no-NS locks). Read the oracle text
explicitly looking for the words: "for the rest of this turn", "until end
of phase", "you can only Special Summon", "cannot Special Summon except".

Before committing to a plan that activates card X, briefly state:
"I am activating X because [enabler] — and I have verified that X's
constraint [lock-text or 'none'] does NOT block [downstream card I need]."

Hand cards aren't always meant to be used. Sometimes the best plan
deliberately leaves a card in hand. Question every activation.
```

**Mechanical companion.** Always run `scripts/enumerate-skip.ts` on the
final candidate plan BEFORE declaring "this is the best" — it
deterministically tests every single-step and pair-step removal in
~30s-2min wall, $0 LLM. If skip-enum surfaces a variant ≥ baseline matched,
the LLM was wrong about the ceiling.

```bash
npx tsx scripts/enumerate-skip.ts \
  --fixture-id=<fixture> \
  --base-plan=path/to/best-plan.json \
  --out-dir=data/path-beta-poc/<fixture>/enumerate-skip/ \
  [--combo-depth=2]
```

Skip-enum result interpretation:
- **All variants ≤ baseline**: empirical local-optimum confirmation. The
  ceiling is real (or requires ADD-step authoring, not skip).
- **One variant > baseline**: the LLM missed a skip — re-author with that
  step removed.
- **Multiple variants tied at baseline**: the skipped step was redundant
  (no contribution); ship the simpler plan.

---

## Roadmap forward

Décision pending au moment de l'écriture (2026-04-28) :

### Option A — Sequential β-1-v2 sur les 11 fixtures restantes
- Wall : 1-2 jours
- Cost : $0
- Estimation : cum matched **30-40/69** (vs honest 22/69)
- Workflow : un dispatch par fixture, 5-10 attempts, ~150K tokens chacun

### Option B — API direct parallèle
- Wall : quelques heures
- Cost : ~$200-500
- Si rate-limit subscription bloque ou si tu veux aller vite

### Option C — Freeze v2
- Ship 22/69 honest + per-fixture wins comme opt-in
- Pas de scaling auto

### Tier suivant (multi-semaines, vrai ML)
- **Tier 2** : SELECT_CARD always-branchable (remove `MAX=6` cap), extend ranker to SELECT_CARD context
- **Tier 3** : learned context-aware preferences `(state, prompt_source_cardId, candidate) → relevance` — replace `preferredSearchTargets` hardcoded leak by un modèle entrainé. C'est la vraie réponse à "hardcodage non-learned fausse résultats".

---

## Liens importants

- Cumulative verdict : `_bmad-output/solver-data/phase-3/path-beta-cumulative-2026-04-28.md`
- POC initial : `_bmad-output/solver-data/phase-3/path-beta-poc-2026-04-28.md`
- Architecture C terminal : `_bmad-output/solver-data/phase-3/arch-c-phase-3-wiring-2026-04-28.md`
- Replay CLI source : `duel-server/scripts/replay-trajectory-cli.ts`
- Card info CLI : `duel-server/scripts/get-card-info.ts`
- Fixture context dumper : `duel-server/scripts/dump-fixture-context.ts`
- Honest baseline gate : `duel-server/scripts/evaluate-structural.ts:518` (env `SOLVER_DISABLE_PREFERRED=1`)
- Memory entry : `~/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_path_beta_cumulative_2026_04_28.md`
