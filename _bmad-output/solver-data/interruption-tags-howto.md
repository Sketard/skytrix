# Solver Interruption Tags — Generation Procedure

`duel-server/data/interruption-tags.json` is the single source of truth for
which cards count as end-board interruptions and how they score. Adding new
cards (or revalidating existing entries) goes through an AI-assisted prompt
persisted at `_bmad-output/solver-data/interruption-tag-generation-prompt.md`.

## How to add cards

Invoke Claude Code with the cardIds, ask it to read the prompt file, fetch
oracle text from `https://db.ygoprodeck.com/api/v7/cardinfo.php?id={cardId}`
via WebFetch, and produce schema-compliant JSON entries. The new entries are
inserted into `interruption-tags.json` with `_validated: false`. A human must
review and flip `_validated: true` for top-meta cards.

## Schema notes

The schema accepts `sharedOpt`, `totalUsesPerTurn`, per-effect `trigger`, and
audit metadata (`_generatedBy`, `_oracleVersion`, `_validated`). Existing
entries without these fields still load — the loader is forward-compatible.

The `trigger` field is critical: the solver's OPT-aware scoring uses it to
disambiguate which effect of a multi-effect card was activated at a given
prompt context. Missing or wrong triggers fall back to index 0 with a runtime
warning.
