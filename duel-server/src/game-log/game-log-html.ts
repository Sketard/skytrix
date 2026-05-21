// =============================================================================
// game-log-html.ts — render GameLogEntry[] to a standalone HTML document
// -----------------------------------------------------------------------------
// Visual preview of the five-block grammar driven by real replay data. Reuses
// the class names + CSS of `_mockups/mockup-game-log.html` so the preview
// matches the approved mockup.
//
// PURITY: the CSS is INJECTED by the caller (the CLI reads the mockup file).
// This module never touches `fs`. GameLogEntry[] + css string in, HTML out.
//
// Card thumbnails use the mockup's text-placeholder style (card name in the
// thumb) — no image fetching in the prototype.
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

/** HTML-escape a string for safe text interpolation. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/**
 * Render a full standalone HTML document.
 *
 * @param entries        the built game log
 * @param title          document title (replay id / metadata)
 * @param css            the `<style>` body extracted from mockup-game-log.html
 * @param cardImageUrl   optional card-code → artwork URL resolver. When given,
 *                       revealed thumbnails render the real artwork.
 */
export function renderHtml(
  entries: GameLogEntry[],
  title: string,
  css: string,
  cardImageUrl?: CardImageResolver,
): string {
  activeImageResolver = cardImageUrl ?? null;
  const rows = entries.map(renderEntry).join('\n');
  activeImageResolver = null;
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
/* real-artwork thumbnails (game-log prototype — injected by renderHtml) */
.lg-thumb--art { padding: 0; overflow: hidden; }
.lg-thumb--art img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* FIELD-spell cell — appears only when an on-field move targets the Field zone */
.lg-board__field { display: flex; justify-content: center; margin-top: 2px; }
.lg-board__field .lg-cell { width: 13px; }
/* ATK / DEF visual identity — ATK = ambre (offensif), DEF = bleu acier
   (défensif), each with its own pictogram so a stat reads at a glance. */
.lg-combat__stat { display: inline-flex; align-items: center; gap: 2px; }
.lg-combat__stat .material-icons-round { font-size: 9px; }
.lg-combat__def { color: #5fa8d8; }
/* battle-posture pills — the change-position transition (ATK ⇄ DEF) */
.lg-posture {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 1px 5px;
  border-radius: var(--pvp-radius-sm, 2px);
  border: 1px solid currentColor;
  font-family: var(--font-mono); font-size: 8px; font-weight: 700;
}
.lg-posture .material-icons-round { font-size: 10px; color: inherit; }
.lg-posture--atk { color: #e8a23d; }
.lg-posture--def { color: #5fa8d8; }
.lg-posture--before { opacity: .45; }
/* targeting annotation — discreet line under the effect description */
.lg-targets {
  margin: 2px 0 0 var(--space-2);
  font-size: var(--text-xs);
  color: var(--gold-on-surface);
  opacity: .85;
}
/* per-row zone tag (M / M/P / EMZ) so monster vs spell rows read apart */
.lg-board__line { display: flex; align-items: center; gap: 3px; }
.lg-board__line .lg-board__row,
.lg-board__line .lg-board__emz { flex: 1; }
.lg-board__rowtag {
  width: 22px; flex: none;
  font-family: var(--font-mono); font-size: 6px;
  letter-spacing: .04em; text-align: right;
  color: var(--text-muted); opacity: .75;
}
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
</div>
</body>
</html>
`;
}

function renderEntry(entry: GameLogEntry): string {
  switch (entry.block) {
    case 'separator':
      return renderSeparator(entry);
    case 'move':
      return renderMove(entry);
    case 'rng':
      return renderRng(entry);
    case 'combat':
      return renderCombat(entry);
    case 'action':
      return renderAction(entry);
  }
}

// -----------------------------------------------------------------------------
// Separators
// -----------------------------------------------------------------------------
function renderSeparator(e: SeparatorEntry): string {
  switch (e.kind) {
    case 'turn': {
      const [you, opp] = e.lp ?? [0, 0];
      return `        <div class="lg-turn">
          <div class="lg-turn__title">${esc(e.label)}</div>
          <div class="lg-turn__players">
            <div class="lg-turn__p">
              <div class="lg-turn__avatar">🐺</div>
              <div class="lg-turn__meta">
                <span class="lg-turn__name">Toi</span>
                <span class="lg-turn__lp">${you}</span>
              </div>
            </div>
            <div class="lg-turn__p lg-turn__p--opp">
              <div class="lg-turn__avatar">🦊</div>
              <div class="lg-turn__meta">
                <span class="lg-turn__name">Adversaire</span>
                <span class="lg-turn__lp">${opp}</span>
              </div>
            </div>
          </div>
        </div>`;
    }
    case 'phase':
      return `        <div class="lg-phase">${esc(e.label)}</div>`;
    case 'chain-start':
      return chainBar('lg-chain--start', 'link', e.label);
    case 'chain-resolve':
      return chainBar('lg-chain--resolve', 'sync', e.label);
    case 'chain-end':
      return chainBar('lg-chain--end', 'link_off', e.label);
    case 'decision':
      return `        <div class="lg-decision">${esc(e.label)}</div>`;
    case 'duel-over':
      return `        <div class="lg-end"><div class="lg-end__title">${esc(e.label)}</div></div>`;
  }
}

function chainBar(cls: string, icon: string, label: string): string {
  return `        <div class="lg-chain ${cls}">
          <span class="material-icons-round">${icon}</span>
          ${esc(label)}
        </div>`;
}

// -----------------------------------------------------------------------------
// Row head (source card + description)
// -----------------------------------------------------------------------------
function rowClass(e: RowHead): string {
  const opp = e.player === 1 ? ' lg-row--opp' : '';
  const negated = e.negated ? ' lg-row--negated' : '';
  return `lg-row${opp}${negated}`;
}

function renderHead(e: RowHead): string {
  if (!e.source) return '';
  const badge = e.chainLink
    ? `<span class="badge-cl">${e.chainLink}</span>`
    : '';
  const negTag = e.negated ? `<span class="lg-negated-tag">Nié</span>` : '';
  const desc = e.description
    ? `\n          <div class="lg-desc">${esc(e.description.trim())}</div>`
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
function renderMove(e: MoveEntry): string {
  if (e.variant === 'initial-hand') {
    const cards = e.movedCards.map(m => thumb(m.card, '')).join('\n            ');
    return `        <div class="${rowClass(e)}">
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
  const body = e.movedCards.map(renderMovedCard).join('\n');
  return `        <div class="${rowClass(e)}">
${renderHead(e)}
          <div class="lg-body">
${body}
          </div>
        </div>`;
}

function renderMovedCard(m: MovedCard): string {
  // A position change renders a posture transition (ATK ⇄ DEF) instead of
  // the plain verb + destination flow.
  const flow = m.posChange
    ? `<span class="lg-moved__verb">${esc(m.verb)}</span>
                ${posturePill(m.posChange.from, true)}
                <span class="lg-moved__arrow"><span class="material-icons-round">arrow_forward</span></span>
                ${posturePill(m.posChange.to, false)}`
    : `<span class="lg-moved__verb">${esc(m.verb)}</span>
                <span class="lg-moved__arrow"><span class="material-icons-round">arrow_forward</span></span>
                ${destChip(m)}`;
  return `            <div class="lg-moved">
              <div class="lg-moved__card">
                ${thumb(m.card, '')}
                ${cardLabel(m.card)}
              </div>
              <div class="lg-moved__flow">
                ${flow}
              </div>
            </div>`;
}

/**
 * A battle-posture pill — ATK = ambre + cible, DEF = bleu acier + bouclier.
 * `before` dims the pill (the posture being left).
 */
function posturePill(kind: 'ATK' | 'DEF', before: boolean): string {
  const variant = kind === 'ATK' ? 'lg-posture--atk' : 'lg-posture--def';
  const icon = kind === 'ATK' ? 'crisis_alert' : 'shield';
  const dim = before ? ' lg-posture--before' : '';
  return `<span class="lg-posture ${variant}${dim}"><span class="material-icons-round">${icon}</span>${kind}</span>`;
}

function destChip(m: MovedCard): string {
  // An on-field destination renders the FULL mini-board (both players' M+S
  // rows + the shared EMZ band) with the target cell highlighted — per the
  // standardised field-grid rule (chantier §4.2): some effects place cards
  // on the opponent's side, so a half-grid can't represent every position.
  if (m.destCell) {
    return renderMiniBoard(m.destCell);
  }
  if (m.destZone) {
    return `<div class="lg-dest"><small>${esc(m.destZone)}</small></div>`;
  }
  return '';
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
function renderRng(e: RngEntry): string {
  const icon = e.rng === 'coin' ? 'toll' : 'casino';
  const label = e.rng === 'coin' ? 'Lancé de pièce' : 'Lancé de dé';
  const chip = e.rng === 'coin' ? 'lg-rng-coin' : 'lg-rng-die';
  const results = e.results
    .map(r => `<span class="${chip}">${esc(r)}</span>`)
    .join('');
  return `        <div class="${rowClass(e)}">
${renderHead(e)}
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
function renderCombat(e: CombatEntry): string {
  const sides = e.directLabel
    ? `<div class="lg-combat__side">${combatThumb(e.attacker)}</div>
              <div class="lg-combat__direct">${esc(e.directLabel)}</div>`
    : `<div class="lg-combat__side">${combatThumb(e.attacker)}</div>
              <div class="lg-combat__vs"><span class="material-icons-round">bolt</span></div>
              <div class="lg-combat__side">${combatThumb(e.defender ?? e.attacker)}</div>`;
  return `        <div class="${rowClass(e)}">
${renderHead(e)}
          <div class="lg-body">
            <div class="lg-combat">
              ${sides}
            </div>
          </div>
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
function renderAction(e: ActionEntry): string {
  const badge = e.counterBadge
    ? `<span class="lg-counter-badge">${esc(e.counterBadge)}</span>`
    : '';
  const detail = e.detail
    ? `<span class="lg-action__detail">${esc(e.detail)}</span>`
    : '';
  const targets = e.equipTargets?.length
    ? `<div class="lg-action__targets">${e.equipTargets.map(t => thumb(t, '')).join('')}</div>`
    : '';
  return `        <div class="${rowClass(e)}">
${renderHead(e)}
          <div class="lg-body">
            <div class="lg-action">
              <span class="lg-action__icon"><span class="material-icons-round">bolt</span></span>
              <span class="lg-action__label">${esc(e.label)}</span>
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

function cardLabel(ref: LogCardRef): string {
  return ref.revealed
    ? `<span class="lg-moved__name">${cardName(ref)}</span>`
    : `<span class="lg-moved__hidden">Carte non révélée</span>`;
}

function cardName(ref: LogCardRef): string {
  return esc(ref.cardName ?? (ref.cardCode ? `#${ref.cardCode}` : 'Carte'));
}

/** First two words of a card name — fits the small thumbnail box. */
function shortName(ref: LogCardRef): string {
  const name = ref.cardName ?? (ref.cardCode ? `#${ref.cardCode}` : 'carte');
  return name.split(/\s+/).slice(0, 2).join(' ');
}

/** Re-export for the CLI to extract the mockup CSS without re-implementing. */
export { type RelPlayer };
