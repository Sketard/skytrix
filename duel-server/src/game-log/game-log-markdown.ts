// =============================================================================
// game-log-markdown.ts — render GameLogEntry[] to a Markdown document
// -----------------------------------------------------------------------------
// Diff-friendly text rendering of the five-block grammar. Pure: GameLogEntry[]
// in, string out. No imports beyond the entry model.
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

/** Render a full game log to a Markdown string. */
export function renderMarkdown(entries: GameLogEntry[], title: string): string {
  const lines: string[] = [`# Game Log — ${title}`, ''];
  for (const entry of entries) {
    lines.push(...renderEntry(entry));
  }
  lines.push('');
  return lines.join('\n');
}

function renderEntry(entry: GameLogEntry): string[] {
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
function renderSeparator(e: SeparatorEntry): string[] {
  switch (e.kind) {
    case 'turn': {
      const lp = e.lp ? ` — Toi ${e.lp[0]} · Adv ${e.lp[1]}` : '';
      return ['', `## ${e.label}${lp}`, ''];
    }
    case 'phase':
      return [`### — ${e.label} —`, ''];
    case 'chain-start':
      return ['', `**⛓ ${e.label}**`, ''];
    case 'chain-resolve':
      return ['', `**↻ ${e.label}**`, ''];
    case 'chain-end':
      return [`**⛓✕ ${e.label}**`, ''];
    case 'decision':
      return [`> ${e.label}`, ''];
    case 'duel-over':
      return [`> **${e.label}**`, ''];
  }
}

// -----------------------------------------------------------------------------
// Move rows
// -----------------------------------------------------------------------------
function renderMove(e: MoveEntry): string[] {
  const out: string[] = [];
  if (e.variant === 'initial-hand') {
    out.push(`- ${side(e)} **Main de départ** (${e.movedCards.length} cartes)`);
    for (const m of e.movedCards) out.push(`    - ${card(m.card)}`);
    out.push('');
    return out;
  }
  if (e.variant === 'draw-phase') {
    for (const m of e.movedCards) {
      out.push(`- ${side(e)} **Pioche** : ${card(m.card)} → ${m.destZone ?? ''}`);
    }
    out.push('');
    return out;
  }
  out.push(...renderHead(e));
  for (const m of e.movedCards) {
    out.push(`    - ${renderMovedCard(m)}`);
  }
  out.push('');
  return out;
}

function renderMovedCard(m: MovedCard): string {
  const dest = m.destCell
    ? `[${m.destCell.player === 0 ? 'Toi' : 'Adv'} ${m.destCell.row}${m.destCell.sequence + 1}]`
    : m.destZone
      ? `[${m.destZone}]`
      : '';
  const mat = m.isMaterial ? ' _(matériau)_' : '';
  return `${card(m.card)} —${m.verb}→ ${dest}${mat}`;
}

// -----------------------------------------------------------------------------
// RNG rows
// -----------------------------------------------------------------------------
function renderRng(e: RngEntry): string[] {
  const out = renderHead(e);
  const icon = e.rng === 'coin' ? '🪙 Lancé de pièce' : '🎲 Lancé de dé';
  out.push(`    - ${icon} : ${e.results.join(', ')}`);
  out.push('');
  return out;
}

// -----------------------------------------------------------------------------
// Combat rows
// -----------------------------------------------------------------------------
function renderCombat(e: CombatEntry): string[] {
  const out = renderHead(e);
  const verb = e.combat === 'attack' ? '⚔ Attaque' : '🔥 Calcul de combat';
  if (e.directLabel) {
    out.push(`    - ${verb} : ${combatSide(e.attacker)} ${e.directLabel}`);
  } else if (e.defender) {
    out.push(
      `    - ${verb} : ${combatSide(e.attacker)} vs ${combatSide(e.defender)}`,
    );
  } else {
    out.push(`    - ${verb} : ${combatSide(e.attacker)}`);
  }
  out.push('');
  return out;
}

function combatSide(s: CombatEntry['attacker']): string {
  const bits = [card(s.card)];
  if (s.stat) bits.push(`(${s.stat})`);
  if (s.outcome) bits.push(`→ ${s.outcome}`);
  return bits.join(' ');
}

// -----------------------------------------------------------------------------
// Action rows
// -----------------------------------------------------------------------------
function renderAction(e: ActionEntry): string[] {
  const out = renderHead(e);
  const parts = [`**${e.label}**`];
  if (e.detail) parts.push(e.detail);
  if (e.counterBadge) parts.push(`\`${e.counterBadge}\``);
  if (e.targets?.length) {
    parts.push('→ ' + e.targets.map(card).join(', '));
  }
  out.push(`    - ${parts.join(' ')}`);
  out.push('');
  return out;
}

// -----------------------------------------------------------------------------
// Shared head rendering (source card + description + chain badge)
// -----------------------------------------------------------------------------
function renderHead(e: RowHead): string[] {
  const out: string[] = [];
  const badge = e.chainLink ? `①②③④⑤⑥⑦⑧⑨⑩`[e.chainLink - 1] ?? `[${e.chainLink}]` : '';
  const negated = e.negated ? ' ~~(NIÉ)~~' : '';
  const head = e.source ? card(e.source) : '_(aucune carte source)_';
  out.push(`- ${side(e)}${badge ? badge + ' ' : ''}${head}${negated}`);
  if (e.description) {
    out.push(`    > « ${e.description.trim()} »`);
  }
  return out;
}

function side(e: { player: RelPlayer }): string {
  return e.player === 0 ? '🔵' : '🔴';
}

function card(ref: LogCardRef): string {
  if (!ref.revealed) return '_Carte non révélée_';
  return `**${ref.cardName ?? `#${ref.cardCode}`}**`;
}
