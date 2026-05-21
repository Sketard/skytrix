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
  RowHead,
  RelPlayer,
} from './game-log-types.js';

const CHAIN_BADGES = '①②③④⑤⑥⑦⑧⑨⑩';

/** HTML-escape a string for safe text interpolation. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render a full standalone HTML document.
 *
 * @param entries the built game log
 * @param title   document title (replay id / metadata)
 * @param css     the `<style>` body extracted from mockup-game-log.html
 */
export function renderHtml(
  entries: GameLogEntry[],
  title: string,
  css: string,
): string {
  const rows = entries.map(renderEntry).join('\n');
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
  return `          <div class="lg-src">
            ${badge}
            ${thumb(e.source, 'lg-thumb--src')}
            <span class="lg-src__name">${cardName(e.source)}</span>
            ${negTag}
          </div>${desc}`;
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
  return `            <div class="lg-moved">
              <div class="lg-moved__card">
                ${thumb(m.card, '')}
                ${cardLabel(m.card)}
              </div>
              <div class="lg-moved__flow">
                <span class="lg-moved__verb">${esc(m.verb)}</span>
                <span class="lg-moved__arrow"><span class="material-icons-round">arrow_forward</span></span>
                ${destChip(m)}
              </div>
            </div>`;
}

function destChip(m: MovedCard): string {
  if (m.destCell) {
    const owner = m.destCell.player === 0 ? 'Toi' : 'Adv';
    return `<div class="lg-dest"><small>${owner} ${esc(m.destCell.row)}${m.destCell.sequence + 1}</small></div>`;
  }
  if (m.destZone) {
    return `<div class="lg-dest"><small>${esc(m.destZone)}</small></div>`;
  }
  return '';
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
                <span class="lg-combat__stat">${esc(stat)}</span>`;
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
  const targets = e.targets?.length
    ? `<div class="lg-action__targets">${e.targets.map(t => thumb(t, '')).join('')}</div>`
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
