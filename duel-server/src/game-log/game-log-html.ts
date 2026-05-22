// =============================================================================
// game-log-html.ts — render GameLogEntry[] to a standalone HTML document
// -----------------------------------------------------------------------------
// Visual preview of the five-block grammar driven by real replay data.
//
// PURITY: the CSS is INJECTED by the caller (the CLI reads `game-log.css`, the
// single source of truth). This module never touches `fs`, and never appends
// its own CSS — every rule, including `.lg-thumb--art`, lives in game-log.css.
// GameLogEntry[] + css string in, HTML out.
//
// O9: the GameLogBuilder emits i18n KEYS, not French strings. This dev-artefact
// renderer translates them through `KEY_TO_FR` (`game-log-fr-strings.ts`) so
// the preview stays readable French — it is not i18n-bound.
//
// Card thumbnails render real artwork when a CardImageResolver is supplied,
// else fall back to a text-placeholder (card name in the thumb).
// =============================================================================

import type {
  GameLogEntry,
  SeparatorEntry,
  MoveEntry,
  RngEntry,
  CombatEntry,
  ActionEntry,
  LogCardRef,
  MovedCard,
  BoardCell,
  RowHead,
  RelPlayer,
} from './game-log-types.js';
import { frString } from './game-log-fr-strings.js';

/** HTML-escape a string for safe text interpolation. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// -----------------------------------------------------------------------------
// Player avatar — a faithful copy of the front-end `AvatarComponent` logic
// (front/src/app/shared/avatar/avatar.component.ts). Same djb2 hash → hue, so
// a given pseudo gets the SAME gradient here as in the live duel HUD. The HTML
// preview must NOT diverge from the real avatar, hence the duplicated formula.
// -----------------------------------------------------------------------------

/** Stable hue (0-359) from a string — djb2 hash, identical to AvatarComponent. */
function hueFromString(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) + input.charCodeAt(i);
  }
  return Math.abs(h) % 360;
}

/** First character of a pseudo, uppercased — the avatar's initial (`?` if empty). */
function avatarInitial(pseudo: string): string {
  const p = pseudo.trim();
  return p.length > 0 ? p[0].toUpperCase() : '?';
}

/**
 * Render a player avatar disc — gradient background + initial, coloured by a
 * stable hash of the pseudo. Mirrors `<app-avatar>` so the game-log preview
 * matches the real duel HUD. The pseudo also lands in `aria-label` (the disc
 * is a `role="img"`).
 */
function avatarMarkup(pseudo: string): string {
  const h = hueFromString(pseudo);
  const bg =
    `linear-gradient(135deg, hsl(${h},65%,45%), hsl(${(h + 30) % 360},70%,30%))`;
  const border = `hsl(${h},60%,55%)`;
  return (
    `<div class="lg-turn__avatar" role="img" aria-label="${esc(pseudo)}"` +
    ` style="background:${bg};border-color:${border}">` +
    `${esc(avatarInitial(pseudo))}</div>`
  );
}

/**
 * Resolves a card code to an artwork URL. Injected by the caller so the
 * renderer stays pure (it never knows the backend host). Return `null` to
 * fall back to the text-placeholder thumbnail.
 */
export type CardImageResolver = (cardCode: number) => string | null;

/** Module-scoped per-render image resolver — set for the duration of one
 *  `renderHtml` call so the leaf `thumb()` helper can reach it without
 *  threading the resolver through every render function's signature. */
let activeImageResolver: CardImageResolver | null = null;

/** Module-scoped per-render player pseudos, in RELATIVE order [you, opp] —
 *  same convention as the `turn` separator's `lp`. Drives the turn-header
 *  avatars; falls back to generic labels when the caller omits them. */
let activePlayerNames: [string, string] = ['Toi', 'Adversaire'];

/**
 * Render a full standalone HTML document.
 *
 * @param entries        the built game log
 * @param title          document title (replay id / metadata)
 * @param css            the full game-log.css body, injected verbatim into
 *                       the document `<style>` (single source of truth)
 * @param cardImageUrl   optional card-code → artwork URL resolver. When given,
 *                       revealed thumbnails render the real artwork.
 * @param playerNames    optional [you, opp] pseudos in RELATIVE order — drives
 *                       the turn-header avatars (initial + hashed colour).
 */
export function renderHtml(
  entries: GameLogEntry[],
  title: string,
  css: string,
  cardImageUrl?: CardImageResolver,
  playerNames?: [string, string],
): string {
  activeImageResolver = cardImageUrl ?? null;
  activePlayerNames = playerNames ?? ['Toi', 'Adversaire'];
  const rows = renderStream(entries);
  // Column 2 — "Other design": the design cases a single replay can't
  // exercise (materials, RNG, direct attack, counter, equip, …) rendered
  // through the SAME render functions from a synthetic catalogue. One file,
  // zero hand-written demo markup to drift — the catalogue is the only
  // place these cases live and it shares the renderer end to end.
  const catalogue = renderStream(buildShowcaseEntries());
  activeImageResolver = null;
  activePlayerNames = ['Toi', 'Adversaire'];
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<title>Game Log — ${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Rajdhani:wght@500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/icon?family=Material+Icons+Round" rel="stylesheet">
<style>
${css}
</style>
</head>
<body>
<div class="page-head">
  <h1>Game Log — ${esc(title)}</h1>
  <p>Aperçu visuel généré depuis un replay réel — grammaire à 5 blocs.</p>
</div>
<div class="stage">
  <div class="col">
    <div class="col-label">Game Log — données replay réelles</div>
    <div class="gamelog">
      <div class="gamelog__head">
        <div class="gamelog__title">
          <span class="material-icons-round">history_edu</span>
          Journal
        </div>
        <button class="gamelog__close"><span class="material-icons-round">close</span></button>
      </div>
      <div class="gamelog__scroll">
${rows}
      </div>
    </div>
  </div>
  <div class="col">
    <div class="col-label">Other design — cas absents de ce replay</div>
    <div class="gamelog">
      <div class="gamelog__head">
        <div class="gamelog__title">
          <span class="material-icons-round">palette</span>
          Catalogue
        </div>
        <button class="gamelog__close"><span class="material-icons-round">close</span></button>
      </div>
      <div class="gamelog__scroll">
${catalogue}
      </div>
    </div>
  </div>
</div>
</body>
</html>
`;
}

// -----------------------------------------------------------------------------
// Stream rendering — folds the chain delimiter trio into ONE grouped block.
// -----------------------------------------------------------------------------
//
// Design decision D-B (chantier §4.2): a chain renders as a single visual
// group, not three full-width separator bars. The builder still emits the
// `chain-start` / `chain-resolve` / `chain-end` separators (they are the
// parse signal) — this renderer FOLDS them:
//   - `chain-start`   → opens `<div class="lg-chaingroup">` + a header that
//                       names the link count (counted by a forward scan).
//   - `chain-resolve` → an inline `.lg-chainmark` sub-marker, NOT a bar.
//   - `chain-end`     → closes the group; the left rail simply stops.
//
// `isResolution` flags every move row that appears AFTER `chain-resolve` so
// the renderer can echo (not re-print) the duplicated effect description —
// design decision D-C.

/** Render the whole entry stream, grouping chains into `.lg-chaingroup`. */
function renderStream(entries: GameLogEntry[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    if (entry.block === 'separator' && entry.kind === 'chain-start') {
      const end = chainGroupEnd(entries, i);
      out.push(renderChainGroup(entries.slice(i + 1, end)));
      // Skip past the consumed chain-end separator (if present).
      i = end < entries.length ? end + 1 : end;
      continue;
    }
    out.push(renderEntry(entry, false));
    i++;
  }
  return out.join('\n');
}

/** Index of the `chain-end` separator closing the chain opened at `start`,
 *  or `entries.length` when the stream ends with an unclosed chain. */
function chainGroupEnd(entries: GameLogEntry[], start: number): number {
  for (let j = start + 1; j < entries.length; j++) {
    const e = entries[j];
    if (e.block === 'separator' && e.kind === 'chain-end') return j;
    // A turn separator implicitly closes a straggling chain (defensive —
    // the builder resets chain state on a turn boundary).
    if (e.block === 'separator' && e.kind === 'turn') return j;
  }
  return entries.length;
}

/**
 * Render one chain as a grouped block: header + bracketed rows. `inner` is the
 * slice of entries BETWEEN `chain-start` and `chain-end` (exclusive).
 */
function renderChainGroup(inner: GameLogEntry[]): string {
  // Link count = distinct chainLink values across the activation rows (the
  // rows BEFORE the `chain-resolve` marker). Resolution rows reuse the same
  // chainLink values, so counting both halves would double it.
  const links = new Set<number>();
  let seenResolve = false;
  for (const e of inner) {
    if (e.block === 'separator' && e.kind === 'chain-resolve') seenResolve = true;
    if (!seenResolve && e.block === 'move' && e.chainLink) links.add(e.chainLink);
  }
  const n = links.size;
  const countLabel = n === 1 ? '1 maillon' : `${n} maillons`;

  const body: string[] = [];
  let resolution = false;
  for (const e of inner) {
    if (e.block === 'separator' && e.kind === 'chain-resolve') {
      resolution = true;
      body.push(`          <div class="lg-chainmark">
            <span class="material-icons-round">sync</span>
            Résolution
          </div>`);
      continue;
    }
    body.push(renderEntry(e, resolution));
  }

  return `        <div class="lg-chaingroup">
          <div class="lg-chaingroup__head">
            <span class="material-icons-round">link</span>
            Chaîne
            <span class="lg-chaingroup__count">${countLabel}</span>
          </div>
${body.join('\n')}
        </div>`;
}

/** Render a single entry. `isResolution` = the entry sits after the chain's
 *  `chain-resolve` marker (drives the description-echo of D-C). */
function renderEntry(entry: GameLogEntry, isResolution: boolean): string {
  switch (entry.block) {
    case 'separator':
      return renderSeparator(entry);
    case 'move':
      return renderMove(entry, isResolution);
    case 'rng':
      return renderRng(entry, isResolution);
    case 'combat':
      return renderCombat(entry, isResolution);
    case 'action':
      return renderAction(entry, isResolution);
  }
}

// -----------------------------------------------------------------------------
// Separators — chain delimiters are folded by renderStream and never reach here.
// -----------------------------------------------------------------------------
function renderSeparator(e: SeparatorEntry): string {
  switch (e.kind) {
    case 'turn': {
      const [you, opp] = e.lp ?? [0, 0];
      // Avatars + names mirror the live duel HUD (`<app-avatar>` / player
      // card): same djb2-hashed gradient per pseudo. `activePlayerNames` is
      // relative [you, opp] — same order as `e.lp`.
      const [youName, oppName] = activePlayerNames;
      // STRUCTURED kind — compose "Tour N" from the carried turnNumber.
      return `        <div class="lg-turn">
          <div class="lg-turn__title">Tour ${esc(String(e.turnNumber ?? '?'))}</div>
          <div class="lg-turn__players">
            <div class="lg-turn__p">
              ${avatarMarkup(youName)}
              <div class="lg-turn__meta">
                <span class="lg-turn__name">${esc(youName)}</span>
                <span class="lg-turn__lp">${you}</span>
              </div>
            </div>
            <div class="lg-turn__p lg-turn__p--opp">
              ${avatarMarkup(oppName)}
              <div class="lg-turn__meta">
                <span class="lg-turn__name">${esc(oppName)}</span>
                <span class="lg-turn__lp">${opp}</span>
              </div>
            </div>
          </div>
        </div>`;
    }
    case 'phase':
      // Key-pure kind — `labelKey` translated through KEY_TO_FR.
      return `        <div class="lg-phase">${esc(frString(e.labelKey ?? ''))}</div>`;
    // Chain delimiters are consumed by renderStream → renderChainGroup; a stray
    // one reaching here means an unbalanced stream — render nothing.
    case 'chain-start':
    case 'chain-resolve':
    case 'chain-end':
      return '';
    case 'decision':
      // STRUCTURED kind — never emitted by the current builder; render nothing.
      return '';
    case 'duel-over': {
      // STRUCTURED kind — compose the winner line + reason from the side and
      // the win-reason key.
      const winner =
        e.winnerSide === 0 ? 'Toi — Victoire' : 'Adversaire — Victoire';
      const reason = e.reasonKey
        ? `<div class="lg-end__reason">${esc(frString(e.reasonKey))}</div>`
        : '';
      return `        <div class="lg-end"><div class="lg-end__title">🏆 ${esc(winner)}</div>${reason}</div>`;
    }
  }
}

// -----------------------------------------------------------------------------
// Row head (source card + description)
// -----------------------------------------------------------------------------
//
// Design decision D-C (chantier §4.2): two row weights.
//   - A FULL row has a source card → full chrome (side rail, surface).
//   - A BARE row is a source-less system move (`Mélange du Deck`, `Retour à
//     l'Extra`, rule-driven relocations) → no rail, no surface, near a plain
//     line of text. `isBareRow` decides.
// And the resolution row of a chain MUST NOT re-print the effect description
// (identical to the activation row) — `isResolution` switches `.lg-desc` to
// the ténu `.lg-desc--echo`.

/** A move row is BARE when it has no source AND is a standalone system move
 *  (not one of the initial-hand / draw-phase special variants, which have
 *  their own dedicated rendering). */
function isBareRow(e: GameLogEntry): boolean {
  return (
    e.block === 'move' &&
    !e.source &&
    e.variant !== 'initial-hand' &&
    e.variant !== 'draw-phase'
  );
}

function rowClass(e: RowHead, bare: boolean): string {
  const side = e.player === 1 ? ' lg-row--opp' : ' lg-row--self';
  const negated = e.negated ? ' lg-row--negated' : '';
  const bareCls = bare ? ' lg-row--bare' : '';
  return `lg-row${side}${negated}${bareCls}`;
}

/**
 * The full attribute string for a `.lg-row` div — class plus, for FULL rows
 * only, keyboard affordances (`tabindex` + `role="button"`). A full row is
 * an activation/event the reader can focus to inspect; a bare row is a
 * non-interactive system "whisper" (`cursor: default`) and stays a plain
 * div — never focusable. This mirrors the `.lg-row:focus-visible` CSS rule.
 */
function rowAttrs(e: RowHead, bare: boolean): string {
  const cls = `class="${rowClass(e, bare)}"`;
  return bare ? cls : `${cls} tabindex="0" role="button"`;
}

/**
 * Render the source-card header + description + targeting annotation.
 * `isResolution` echoes the description (D-C) instead of re-printing the full
 * effect box.
 */
function renderHead(e: RowHead, isResolution: boolean): string {
  if (!e.source) return '';
  const badge = e.chainLink
    ? `<span class="badge-cl">${e.chainLink}</span>`
    : '';
  const negTag = e.negated ? `<span class="lg-negated-tag">Nié</span>` : '';
  // D-C: a resolution row echoes the description ténu (single line), never the
  // full effect box — it is identical to the activation row above it.
  const descCls = isResolution ? 'lg-desc lg-desc--echo' : 'lg-desc';
  const desc = e.description
    ? `\n          <div class="${descCls}">${esc(e.description.trim())}</div>`
    : '';
  // Targeting is a discreet annotation of the effect row, not its own row.
  const targetLine = e.targets?.length
    ? `\n          <div class="lg-targets">▸ cible : ${e.targets
        .map(cardName)
        .join(', ')}</div>`
    : '';
  return `          <div class="lg-src">
            ${badge}
            ${thumb(e.source, 'lg-thumb--src')}
            <span class="lg-src__name">${cardName(e.source)}</span>
            ${negTag}
          </div>${desc}${targetLine}`;
}

// -----------------------------------------------------------------------------
// Move rows
// -----------------------------------------------------------------------------
function renderMove(e: MoveEntry, isResolution: boolean): string {
  if (e.variant === 'initial-hand') {
    const cards = e.movedCards.map(m => thumb(m.card, '')).join('\n            ');
    return `        <div class="${rowClass(e, false)}">
          <div class="lg-body">
            <div class="lg-moved">
              <div class="lg-draw5">
            ${cards}
              </div>
              <div class="lg-moved__flow"><span class="lg-moved__verb">Main de départ</span></div>
            </div>
          </div>
        </div>`;
  }
  const bare = isBareRow(e);
  // Full and bare rows share the SAME moved-card body (renderMovedCard) — the
  // only difference is the outer .lg-row chrome (rail, surface, description
  // box) handled by rowClass. A move reads identically everywhere.
  //
  // De-duplication: when a moved card IS the row's source card (an effect
  // that displaces its own activator), the source name already sits in the
  // `.lg-src` head — the moved-card's own name header would print it twice.
  // `suppressName` drops the redundant header for that card; its body
  // (thumbnail + flow) still renders.
  const body = e.movedCards
    .map(m => renderMovedCard(m, isSameCard(m.card, e.source)))
    .join('\n');
  return `        <div ${rowAttrs(e, bare)}>
${renderHead(e, isResolution)}
          <div class="lg-body">
${body}
          </div>
        </div>`;
}

/** True when a moved card and the row's source are the same revealed card.
 *  A hidden card (cardCode null) never matches — it carries no identity. */
function isSameCard(moved: LogCardRef, source: LogCardRef | null): boolean {
  return (
    source != null &&
    moved.revealed &&
    source.revealed &&
    moved.cardCode != null &&
    moved.cardCode === source.cardCode
  );
}

/** The name line of a moved card — revealed name or the hidden placeholder. */
function bareName(m: MovedCard): string {
  return m.card.revealed
    ? `<span class="lg-bare__name">${cardName(m.card)}</span>`
    : `<span class="lg-bare__name lg-bare__name--hidden">Carte non révélée</span>`;
}

/**
 * Render a moved card — the body of any move row, full OR bare.
 *
 * Two-tier anatomy (2026-05-22 with the user): the card NAME is a
 * full-width HEADER anchored at the top (`.lg-bare__head`); BELOW a thin
 * rule, the BODY (`.lg-bare__body`) holds the thumbnail + the
 * `source → dest` flow. The name no longer floats above a variable-height
 * flow — it has a stable anchor regardless of whether the destination is a
 * one-line pile chip or a tall mini-board. Full and bare rows render
 * IDENTICALLY here; they differ only in the OUTER `.lg-row` chrome handled
 * by `renderMove` / `rowClass`.
 *
 * `suppressName` drops the name header (the source name above already
 * carries it) — the body renders alone.
 */
function renderMovedCard(m: MovedCard, suppressName = false): string {
  const head = suppressName
    ? ''
    : `\n              <div class="lg-bare__head">${bareName(m)}</div>`;
  return `            <div class="lg-bare">${head}
              <div class="lg-bare__body">
                ${thumb(m.card, 'lg-bare__thumb')}
                ${renderMovedFlow(m)}
              </div>
            </div>`;
}

/** The SVG arrowhead — a fixed cap. The shaft is a flex-stretched `::before`
 *  rule on `.lg-bare__arrow`, so the arrow always spans exactly the verb's
 *  width. SVG (not a glyph) so the cap aligns optically with the shaft. */
const ARROW_SVG =
  '<svg width="6" height="8" viewBox="0 0 6 8">' +
  '<path d="M0 1l5 3-5 3" stroke="currentColor" stroke-width="1.4" ' +
  'fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The verb+arrow leg — a column where the verb (nowrap) dictates the width
 *  and the arrow below stretches to match it. */
function flowLeg(verb: string): string {
  return `<span class="lg-bare__leg">
                  <span class="lg-bare__verb">${esc(verb)}</span>
                  <span class="lg-bare__arrow">${ARROW_SVG}</span>
                </span>`;
}

/** A pile-zone slot — a dashed card-slot cell carrying the pile name. The
 *  destination slot is gold-tinted (`isDest`) as the flow's endpoint. */
function pileSlot(zone: string, isDest: boolean): string {
  const cls = isDest ? 'lg-bare__pile lg-bare__pile--dest' : 'lg-bare__pile';
  return `<span class="${cls}"><small>${esc(zone)}</small></span>`;
}

/**
 * The flow under a moved card's head.
 *   - position change → verb + a posture transition (`ATK → DEF`).
 *   - field destination → source pile-slot — verb/arrow leg — mini-board.
 *   - pile destination → source pile-slot — verb/arrow leg — dest pile-slot.
 * Zones render in their real appearance: a pile is a dashed card-slot, a
 * field cell is the full mini-board (standardised field-grid rule).
 */
function renderMovedFlow(m: MovedCard): string {
  // `verb` and the zone tags are i18n keys — translate through KEY_TO_FR.
  const verb = frString(m.verb);
  if (m.posChange) {
    return `<div class="lg-bare__flow">
                  ${flowLeg(verb)}
                  <span class="lg-bare__zones">${esc(m.posChange.from)} → ${esc(m.posChange.to)}</span>
                </div>`;
  }
  // A field destination is ALWAYS the full mini-board; a pile destination is
  // a dashed card-slot tinted gold.
  const destPart = m.destCell
    ? renderMiniBoard(m.destCell)
    : m.destZone
      ? pileSlot(frString(m.destZone), true)
      : '';
  if (!destPart) {
    return `<div class="lg-bare__flow">
                  ${flowLeg(verb)}
                </div>`;
  }
  return `<div class="lg-bare__flow">
                  ${m.fromZone ? pileSlot(frString(m.fromZone), false) : ''}
                  ${flowLeg(verb)}
                  ${destPart}
                </div>`;
}

/**
 * Render the full two-halves mini-board with one cell highlighted.
 * Layout top→bottom: opponent M row, opponent S row, shared EMZ band,
 * your S row, your M row — mirroring the skytrix board.
 */
function renderMiniBoard(target: BoardCell): string {
  // Each row is prefixed by its zone tag (M = monster, S = spell/trap) so a
  // reader can tell the rows apart — the dashed border on S cells alone is
  // too subtle at this size.
  const row = (
    rel: RelPlayer,
    kind: 'M' | 'S',
    cellClass: string,
  ): string => {
    const cells: string[] = [];
    for (let seq = 0; seq < 5; seq++) {
      const hit =
        target.player === rel && target.row === kind && target.sequence === seq;
      cells.push(`<div class="lg-cell${cellClass}${hit ? ' lg-cell--target' : ''}"></div>`);
    }
    const tag = kind === 'M' ? 'M' : 'M/P';
    return `<div class="lg-board__line"><span class="lg-board__rowtag">${tag}</span><div class="lg-board__row">${cells.join('')}</div></div>`;
  };
  // EMZ band — a 5-column grid aligned with the M/S rows. The two shared
  // Extra Monster Zones sit at columns 1 and 3 (the layout a real board
  // uses); columns 0/2/4 are empty spacers so the band lines up vertically
  // with the monster zones above and below it.
  const emz = (): string => {
    const EMZ_COLUMNS = [1, 3]; // grid columns that hold an EMZ cell
    const cells: string[] = [];
    for (let col = 0; col < 5; col++) {
      const emzSlot = EMZ_COLUMNS.indexOf(col); // -1 = spacer, else 0|1
      if (emzSlot < 0) {
        cells.push('<div class="lg-cell"></div>');
        continue;
      }
      const hit = target.row === 'EMZ' && target.sequence === emzSlot;
      cells.push(`<div class="lg-cell lg-cell--emz${hit ? ' lg-cell--target' : ''}"></div>`);
    }
    // Wrapped in the same line/tag layout as the M and S rows so the EMZ
    // band stays column-aligned with them.
    return `<div class="lg-board__line"><span class="lg-board__rowtag">EMZ</span><div class="lg-board__emz">${cells.join('')}</div></div>`;
  };
  // FIELD spell cell — a single standalone cell.
  const fieldHit = target.row === 'FIELD';
  const fieldNote = fieldHit
    ? `<div class="lg-board__field"><div class="lg-cell lg-cell--target"></div></div>`
    : '';
  // Row order mirrors a real board around the central EMZ band: each side's
  // Monster row borders the EMZ, the Spell/Trap row sits on the outside.
  //   Adv. S · Adv. M · EMZ · Toi M · Toi S
  return `<div class="lg-board" title="terrain complet — case ciblée">
                  <div class="lg-board__label lg-board__label--opp"><span>Adv.</span></div>
                  ${row(1, 'S', ' lg-cell--st')}
                  ${row(1, 'M', '')}
                  ${emz()}
                  ${row(0, 'M', '')}
                  ${row(0, 'S', ' lg-cell--st')}
                  <div class="lg-board__label lg-board__label--self"><span>Toi</span></div>
                  ${fieldNote}
                </div>`;
}

// -----------------------------------------------------------------------------
// RNG rows
// -----------------------------------------------------------------------------
function renderRng(e: RngEntry, isResolution: boolean): string {
  const icon = e.rng === 'coin' ? 'toll' : 'casino';
  const label = e.rng === 'coin' ? 'Lancé de pièce' : 'Lancé de dé';
  const chip = e.rng === 'coin' ? 'lg-rng-coin' : 'lg-rng-die';
  // Coin results are i18n keys (`gameLog.rng.heads/tails`); dice results are
  // plain numeric strings — both pass through `frString` (a number string is
  // not a key, so it is returned verbatim).
  const results = e.results
    .map(r => `<span class="${chip}">${esc(frString(r))}</span>`)
    .join('');
  return `        <div ${rowAttrs(e, false)}>
${renderHead(e, isResolution)}
          <div class="lg-body">
            <div class="lg-rng">
              <span class="lg-rng__icon"><span class="material-icons-round">${icon}</span></span>
              <span class="lg-rng__label">${label}</span>
              <div class="lg-rng__results">${results}</div>
            </div>
          </div>
        </div>`;
}

// -----------------------------------------------------------------------------
// Combat rows
// -----------------------------------------------------------------------------
function renderCombat(e: CombatEntry, isResolution: boolean): string {
  // Direct attack — the attacker strikes the player, no defender. Rendered
  // as attacker thumb → bolt → a player "target" pill, instead of a flat
  // red string. The actual LP loss (if any) shows on the dedicated line
  // below — `renderLpLoss`.
  const sides = e.directLabel
    ? `<div class="lg-combat__side">${combatThumb(e.attacker)}</div>
              <div class="lg-combat__vs"><span class="material-icons-round">bolt</span></div>
              <div class="lg-combat__player">
                <span class="lg-combat__player-ico"><span class="material-icons-round">person</span></span>
                <span class="lg-combat__player-dmg">${esc(frString(e.directLabel))}</span>
              </div>`
    : `<div class="lg-combat__side">${combatThumb(e.attacker)}</div>
              <div class="lg-combat__vs"><span class="material-icons-round">bolt</span></div>
              <div class="lg-combat__side">${combatThumb(e.defender ?? e.attacker)}</div>`;
  return `        <div ${rowAttrs(e, false)}>
${renderHead(e, isResolution)}
          <div class="lg-body">
            <div class="lg-combat">
              ${sides}
            </div>${renderLpLoss(e.lpLoss)}
          </div>
        </div>`;
}

/**
 * The LP-loss line of a combat — one chip per player who actually lost LP.
 * Returns '' when nobody lost LP, so the row shows NOTHING in that case
 * (a clash with no damage gets no damage line). Player 0 = "Toi",
 * player 1 = "Adversaire".
 */
function renderLpLoss(losses: CombatEntry['lpLoss']): string {
  if (!losses?.length) return '';
  const chips = losses
    .map(l => {
      const who = l.player === 0 ? 'Toi' : 'Adversaire';
      return `<span class="lg-lploss__chip">
                <span class="material-icons-round">person</span>
                <span class="lg-lploss__who">${who}</span>
                <span class="lg-lploss__amt">−${l.amount} PV</span>
              </span>`;
    })
    .join('\n              ');
  return `
            <div class="lg-lploss">
              ${chips}
            </div>`;
}

function combatThumb(s: CombatEntry['attacker']): string {
  const stat = s.stat ?? s.outcome ?? '';
  return `${thumb(s.card, 'lg-combat__thumb')}
                ${statBadge(stat)}`;
}

/**
 * Render a combat stat line with its ATK/DEF identity. ATK = ambre + cible,
 * DEF = bleu acier + bouclier. A non-ATK/DEF string (a damage outcome like
 * "détruit" / "0") keeps the neutral damage style.
 */
function statBadge(stat: string): string {
  const trimmed = stat.trim();
  if (!trimmed) return '';
  if (/^ATK\b/i.test(trimmed)) {
    return `<span class="lg-combat__stat lg-combat__atk"><span class="material-icons-round">crisis_alert</span>${esc(trimmed)}</span>`;
  }
  if (/^DEF\b/i.test(trimmed)) {
    return `<span class="lg-combat__stat lg-combat__def"><span class="material-icons-round">shield</span>${esc(trimmed)}</span>`;
  }
  return `<span class="lg-combat__stat lg-combat__dmg">${esc(trimmed)}</span>`;
}

// -----------------------------------------------------------------------------
// Action rows
// -----------------------------------------------------------------------------
function renderAction(e: ActionEntry, isResolution: boolean): string {
  const badge = e.counterBadge
    ? `<span class="lg-counter-badge">${esc(e.counterBadge)}</span>`
    : '';
  // Counter rows carry a numeric type — compose "Type N" from the i18n key.
  const detail =
    e.counterType !== undefined
      ? `<span class="lg-action__detail">${esc(
          frString('gameLog.action.counterType').replace(
            '{n}',
            String(e.counterType),
          ),
        )}</span>`
      : '';
  const targets = e.equipTargets?.length
    ? `<div class="lg-action__targets">${e.equipTargets.map(t => thumb(t, '')).join('')}</div>`
    : '';
  return `        <div ${rowAttrs(e, false)}>
${renderHead(e, isResolution)}
          <div class="lg-body">
            <div class="lg-action">
              <span class="lg-action__icon"><span class="material-icons-round">bolt</span></span>
              <span class="lg-action__label">${esc(frString(e.labelKey))}</span>
              ${detail}
              ${targets}
              ${badge}
            </div>
          </div>
        </div>`;
}

// -----------------------------------------------------------------------------
// Card primitives
// -----------------------------------------------------------------------------
function thumb(ref: LogCardRef, extra: string): string {
  const cls = `lg-thumb${extra ? ' ' + extra : ''}${ref.revealed ? '' : ' lg-thumb--back'}`;
  // Revealed card with a resolvable artwork → render the real image; the
  // card name stays as alt text (and as a visible fallback if the image
  // 404s). Otherwise fall back to the text-placeholder thumbnail.
  if (ref.revealed && ref.cardCode != null) {
    const url = activeImageResolver?.(ref.cardCode) ?? null;
    if (url) {
      const alt = esc(shortName(ref));
      return `<div class="${cls} lg-thumb--art"><img src="${esc(url)}" alt="${alt}" loading="lazy"></div>`;
    }
  }
  const inner = ref.revealed ? esc(shortName(ref)) : '';
  return `<div class="${cls}">${inner}</div>`;
}

function cardName(ref: LogCardRef): string {
  return esc(resolvedName(ref) ?? (ref.cardCode ? `#${ref.cardCode}` : 'Carte'));
}

/** First two words of a card name — fits the small thumbnail box. */
function shortName(ref: LogCardRef): string {
  const name = resolvedName(ref) ?? (ref.cardCode ? `#${ref.cardCode}` : 'carte');
  return name.split(/\s+/).slice(0, 2).join(' ');
}

/**
 * The display name of a card ref. `cardName` is usually a real card name, but
 * the combat placeholders (`gameLog.combat.attacker`, …) carry an i18n key —
 * `frString` resolves a key and returns a real name unchanged (a name is never
 * in KEY_TO_FR). Returns null when the ref carries no name.
 */
function resolvedName(ref: LogCardRef): string | null {
  return ref.cardName != null ? frString(ref.cardName) : null;
}

// -----------------------------------------------------------------------------
// Showcase catalogue — the "Other design" column.
// -----------------------------------------------------------------------------
//
// A synthetic GameLogEntry[] covering the design cases a single replay may
// not exercise. Rendered through the SAME renderStream as the real log, so
// the catalogue can never drift from the renderer — it is not hand-written
// HTML, it is data fed to the identical pipeline. Add a missing case here
// (not as static markup) when a new block variant needs a visual reference.

/** A revealed card ref with a display name. */
function showCard(name: string): LogCardRef {
  return { revealed: true, cardCode: null, cardName: name };
}
/** The shared RowHead fields for a showcase entry. */
function showHead(player: RelPlayer, source: LogCardRef | null): RowHead {
  return { player, turnNumber: 1, source, description: null };
}

/**
 * A section-header separator for the catalogue. O9: `phase` is a key-pure
 * separator kind — `labelKey` is translated through `KEY_TO_FR`. These section
 * titles are catalogue captions, not real game phases, so they are not in the
 * table; `frString` returns them verbatim (loud fallback) — intended here.
 */
function showSection(caption: string): GameLogEntry {
  return { block: 'separator', kind: 'phase', labelKey: caption };
}

/**
 * Build the exhaustive showcase catalogue. Covers EVERY block/variant the
 * `GameLogBuilder` can emit (audited against its MSG_* handlers, 2026-05-22):
 *   · move → MZONE per summon kind (Normale/Spéciale/Fusion/Rituelle/
 *     Synchro/Xyz/Lien), → SZONE (Pose), → OVERLAY (Matériau Xyz),
 *     → GRAVE (Envoi/Défausse/Tribut/Matériau), → BANISHED, → HAND
 *     (Ajout/Retour en main), → DECK, → EXTRA, flip, position change
 *   · move with a targeting annotation, and a negated chain row
 *   · rng dice + coin
 *   · combat attack / battle (with & without LP loss) / direct attack
 *   · action counter-add / counter-remove / equip / gy-deck-swap /
 *     shuffle / swap
 * A new builder case MUST get an entry here — this list is the single
 * visual reference for the renderer's full surface.
 *
 * O9: every `verb` / `fromZone` / `destZone` / action `labelKey` / `directLabel`
 * / combat placeholder is an i18n KEY — the same keys the builder emits — so
 * the catalogue exercises the exact translation path the real log uses.
 */
function buildShowcaseEntries(): GameLogEntry[] {
  const eos = showCard('Radiant Typhoon Eos');
  const eldam = showCard('Radiant Typhoon Eldam');
  const krosea = showCard('Radiant Typhoon Krosea');
  const fonix = showCard('Radiant Typhoon Fonix');
  const vision = showCard('Radiant Typhoon Vision');
  const hidden: LogCardRef = { revealed: false, cardCode: null, cardName: null };
  /** A board cell on the viewer's monster row. */
  const cellM = (seq: number): BoardCell => ({ player: 0, row: 'M', sequence: seq });

  // A move entry whose single moved card lands somewhere — the common shape.
  const move = (
    source: LogCardRef | null,
    description: string,
    movedCards: MovedCard[],
    player: RelPlayer = 0,
  ): GameLogEntry => ({ ...showHead(player, source), block: 'move', description, movedCards });

  return [
    // === INVOCATIONS — une par type (move → MZONE) ==========================
    showSection('Invocations'),
    move(eldam, 'Invocation Normale depuis la main.', [
      { card: eldam, verb: 'gameLog.verb.normalSummon', fromZone: 'gameLog.zone.hand', destCell: cellM(2) },
    ]),
    move(vision, 'Invocation Spéciale depuis le GY.', [
      { card: vision, verb: 'gameLog.verb.specialSummon', fromZone: 'gameLog.zone.grave', destCell: cellM(1) },
    ]),
    move(showCard('Radiant Typhoon Dragon'), 'Invocation Fusion.', [
      { card: eldam, verb: 'gameLog.verb.material', fromZone: 'gameLog.zone.hand', destZone: 'gameLog.zone.grave', isMaterial: true },
      { card: krosea, verb: 'gameLog.verb.material', fromZone: 'gameLog.zone.spellTrap', destZone: 'gameLog.zone.grave', isMaterial: true },
      { card: showCard('Radiant Typhoon Dragon'), verb: 'gameLog.verb.fusionSummon', fromZone: 'gameLog.zone.extra', destCell: cellM(2) },
    ]),
    move(showCard('Radiant Ritual Beast'), 'Invocation Rituelle.', [
      { card: showCard('Radiant Ritual Beast'), verb: 'gameLog.verb.ritualSummon', fromZone: 'gameLog.zone.hand', destCell: cellM(0) },
    ]),
    move(showCard('Radiant Typhoon Synchron'), 'Invocation Synchro.', [
      { card: showCard('Radiant Typhoon Synchron'), verb: 'gameLog.verb.synchroSummon', fromZone: 'gameLog.zone.extra', destCell: cellM(3) },
    ]),
    move(showCard('Radiant Typhoon No.7'), 'Invocation Xyz.', [
      { card: showCard('Radiant Typhoon No.7'), verb: 'gameLog.verb.xyzSummon', fromZone: 'gameLog.zone.extra', destCell: cellM(2) },
    ]),
    move(eos, 'Invocation Lien avec 2 Matériaux.', [
      { card: eldam, verb: 'gameLog.verb.material', fromZone: 'gameLog.zone.spellTrap', destZone: 'gameLog.zone.grave', isMaterial: true },
      { card: krosea, verb: 'gameLog.verb.material', fromZone: 'gameLog.zone.spellTrap', destZone: 'gameLog.zone.grave', isMaterial: true },
      { card: eos, verb: 'gameLog.verb.linkSummon', fromZone: 'gameLog.zone.extra', destCell: { player: 0, row: 'EMZ', sequence: 0 } },
    ]),
    move(showCard('Radiant Trap'), 'Pose une carte face verso.', [
      { card: hidden, verb: 'gameLog.verb.set', fromZone: 'gameLog.zone.hand', destCell: { player: 0, row: 'S', sequence: 1 } },
    ]),
    move(eldam, 'Inv. par Flip — le monstre face verso est retourné.', [
      { card: eldam, verb: 'gameLog.verb.flip', fromZone: 'gameLog.zone.spellTrap', destCell: cellM(2) },
    ]),

    // === DÉPLACEMENTS DE CARTE (move → piles) ==============================
    showSection('Déplacements de carte'),
    move(null, 'Pioche de la phase de pioche.', [
      { card: vision, verb: 'gameLog.verb.draw', fromZone: 'gameLog.zone.deck', destZone: 'gameLog.zone.hand' },
    ]),
    move(showCard('Radiant Searcher'), 'Ajoute 1 monstre du Deck à la main.', [
      { card: krosea, verb: 'gameLog.verb.add', fromZone: 'gameLog.zone.deck', destZone: 'gameLog.zone.hand' },
    ]),
    move(showCard('Radiant Recall'), 'Renvoie un monstre du Terrain en main.', [
      { card: eldam, verb: 'gameLog.verb.returnHand', fromZone: 'gameLog.zone.spellTrap', destZone: 'gameLog.zone.hand' },
    ]),
    move(showCard('Card Destruction'), 'Chaque joueur défausse sa main.', [
      { card: hidden, verb: 'gameLog.verb.discard', fromZone: 'gameLog.zone.hand', destZone: 'gameLog.zone.grave' },
      { card: hidden, verb: 'gameLog.verb.draw', fromZone: 'gameLog.zone.deck', destZone: 'gameLog.zone.hand' },
    ], 1),
    move(showCard('Radiant Tribute'), 'Sacrifie un monstre comme Tribut.', [
      { card: eldam, verb: 'gameLog.verb.tribute', fromZone: 'gameLog.zone.spellTrap', destZone: 'gameLog.zone.grave' },
    ]),
    move(showCard('Radiant Banisher'), 'Bannit une carte du Terrain.', [
      { card: krosea, verb: 'gameLog.verb.banish', fromZone: 'gameLog.zone.spellTrap', destZone: 'gameLog.zone.banished' },
    ], 1),
    move(showCard('Radiant Recycle'), 'Renvoie une carte du GY au Deck.', [
      { card: vision, verb: 'gameLog.verb.returnDeck', fromZone: 'gameLog.zone.grave', destZone: 'gameLog.zone.deck' },
    ]),
    move(null, 'Un monstre Pendule détruit retourne à l\'Extra.', [
      { card: eos, verb: 'gameLog.verb.returnExtra', fromZone: 'gameLog.zone.spellTrap', destZone: 'gameLog.zone.extra' },
    ]),
    move(showCard('Radiant Overlay'), 'Attache une carte comme Matériau Xyz.', [
      { card: eldam, verb: 'gameLog.verb.attach', fromZone: 'gameLog.zone.hand', destZone: 'gameLog.zone.overlay', isMaterial: true },
    ]),
    // Position change — posture transition.
    move(eldam, 'Passe ce monstre en Position de Défense.', [
      { card: eldam, verb: 'gameLog.verb.changePos', posChange: { from: 'ATK', to: 'DEF' } },
    ]),

    // === CIBLAGE + EFFET NIÉ ==============================================
    showSection('Ciblage & négation'),
    // A targeting annotation folded onto an activation row.
    {
      ...showHead(1, showCard('Radiant Typhoon Strike')),
      block: 'move',
      description: 'Cible 1 monstre adverse et le détruit.',
      targets: [eldam],
      movedCards: [{ card: eldam, verb: 'gameLog.verb.sendGy', fromZone: 'gameLog.zone.spellTrap', destZone: 'gameLog.zone.grave' }],
    },
    // A negated chain link.
    {
      ...showHead(0, showCard('Radiant Typhoon Draw')),
      block: 'move',
      description: 'Pioche 2 cartes — effet annulé par une contre-carte.',
      chainLink: 1,
      negated: true,
      movedCards: [],
    },

    // === ALÉATOIRE ========================================================
    showSection('Aléatoire'),
    {
      ...showHead(1, showCard('Dicephoon')),
      block: 'rng',
      description: 'Lance un dé à six faces.',
      rng: 'dice',
      results: ['2'],
    },
    {
      ...showHead(0, showCard('Cup of Ace')),
      block: 'rng',
      description: 'Lance une pièce.',
      rng: 'coin',
      results: ['gameLog.rng.heads'],
    },

    // === ACTIONS (compteur, équipement, échanges, mélange) ================
    showSection('Compteurs & échanges'),
    {
      ...showHead(0, showCard('Endymion, the Mighty Master of Magic')),
      block: 'action',
      description: 'Place 2 Compteurs Magie.',
      action: 'counter-add',
      labelKey: 'gameLog.action.counter',
      counterType: 1,
      counterBadge: '+2',
    },
    {
      ...showHead(0, showCard('Endymion, the Mighty Master of Magic')),
      block: 'action',
      description: 'Retire 1 Compteur Magie pour payer un coût.',
      action: 'counter-remove',
      labelKey: 'gameLog.action.counter',
      counterType: 1,
      counterBadge: '−1',
    },
    {
      ...showHead(1, showCard('Mage Power')),
      block: 'action',
      description: 'Équipe ce monstre.',
      action: 'equip',
      labelKey: 'gameLog.action.equip',
      equipTargets: [eldam],
    },
    {
      ...showHead(0, showCard('Exchange of the Spirit')),
      block: 'action',
      description: 'Échange le Cimetière et le Deck.',
      action: 'gy-deck-swap',
      labelKey: 'gameLog.action.gyDeckSwap',
    },
    {
      ...showHead(1, showCard('Mind Control')),
      block: 'action',
      description: 'Deux cartes échangent de contrôleur.',
      action: 'swap',
      labelKey: 'gameLog.action.swap',
    },
    {
      ...showHead(0, showCard('Radiant Shuffle')),
      block: 'action',
      description: 'Mélange le Deck.',
      action: 'shuffle',
      labelKey: 'gameLog.action.shuffleDeck',
    },

    // === COMBAT ===========================================================
    showSection('Combat'),
    // Attack declaration on a monster — no LP line (just a declaration).
    {
      ...showHead(0, eos),
      block: 'combat',
      combat: 'attack',
      attacker: { card: eos, stat: 'ATK 2400' },
      defender: { card: fonix, stat: 'DEF 1900' },
    },
    // Battle damage — the opponent loses LP → the dedicated LP-loss line.
    {
      ...showHead(0, eos),
      block: 'combat',
      combat: 'battle',
      attacker: { card: eos },
      defender: { card: fonix },
      lpLoss: [{ player: 1, amount: 500 }],
    },
    // Battle with NO damage — the LP-loss line is omitted entirely.
    {
      ...showHead(0, eos),
      block: 'combat',
      combat: 'battle',
      attacker: { card: eos },
      defender: { card: fonix },
      lpLoss: [],
    },
    // Direct attack declaration → battle: the player takes the hit.
    {
      ...showHead(1, showCard('Radiant Typhoon Chant')),
      block: 'combat',
      combat: 'attack',
      attacker: { card: showCard('Radiant Typhoon Chant'), stat: 'ATK 1800' },
      directLabel: 'gameLog.combat.directAttack',
    },
    {
      ...showHead(1, showCard('Radiant Typhoon Chant')),
      block: 'combat',
      combat: 'battle',
      attacker: { card: showCard('Radiant Typhoon Chant') },
      defender: { card: { revealed: true, cardCode: null, cardName: 'Joueur' } },
      lpLoss: [{ player: 0, amount: 1800 }],
    },
  ];
}

/** Re-export the relative-player type for the CLI / catalogue builders. */
export { type RelPlayer };
