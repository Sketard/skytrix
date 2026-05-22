// =============================================================================
// game-log-markdown.ts — render GameLogEntry[] to a Markdown document
// -----------------------------------------------------------------------------
// Diff-friendly text rendering of the five-block grammar. Pure: GameLogEntry[]
// in, string out.
//
// O9: the GameLogBuilder emits i18n KEYS, not French strings. This dev-artefact
// renderer translates them through `KEY_TO_FR` (`game-log-fr-strings.ts`) so
// the output stays readable French — the CLI is not i18n-bound.
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
import { frString } from './game-log-fr-strings.js';

/** Render a full game log to a Markdown string. */
export function renderMarkdown(entries: GameLogEntry[], title: string): string {
  const lines: string[] = [`# Game Log — ${title}`, ''];
  // Chain delimiter trio is folded into one grouped block (design decision
  // D-B, chantier §4.2): `chain-start` opens a "⛓ Chaîne · N liens" heading,
  // `chain-resolve` becomes a thin "↻ Résolution" sub-marker, `chain-end`
  // closes silently (no separate bar).
  let resolution = false;
  for (const entry of entries) {
    if (entry.block === 'separator' && entry.kind === 'chain-start') {
      resolution = false;
    }
    if (entry.block === 'separator' && entry.kind === 'chain-resolve') {
      resolution = true;
    }
    lines.push(...renderEntry(entry, resolution));
  }
  lines.push('');
  return lines.join('\n');
}

function renderEntry(entry: GameLogEntry, isResolution: boolean): string[] {
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
// Separators — chain delimiters fold into a grouped heading (D-B).
// -----------------------------------------------------------------------------
function renderSeparator(e: SeparatorEntry): string[] {
  switch (e.kind) {
    case 'turn': {
      // STRUCTURED kind — compose "Tour N" from the carried turnNumber.
      const lp = e.lp ? ` — Toi ${e.lp[0]} · Adv ${e.lp[1]}` : '';
      return ['', `## Tour ${e.turnNumber ?? '?'}${lp}`, ''];
    }
    case 'phase':
      // Key-pure kind — `labelKey` translated through KEY_TO_FR.
      return [`### — ${frString(e.labelKey ?? '')} —`, ''];
    case 'chain-start':
      // Opens a chain group. The link count is not known at this point
      // (the activation rows follow), so the heading stays generic — the
      // HTML renderer, which back-scans, carries the precise count.
      return ['', `**⛓ Chaîne**`, ''];
    case 'chain-resolve':
      // Thin inline sub-marker, not a full bar.
      return [`  ↻ _Résolution_`, ''];
    case 'chain-end':
      // The group simply ends — no terminal bar (D-B).
      return [''];
    case 'decision':
      // STRUCTURED kind — never emitted by the current builder; defensively
      // render nothing rather than a phantom bullet.
      return [''];
    case 'duel-over': {
      // STRUCTURED kind — compose the winner line + reason from the side and
      // the win-reason key.
      const winner =
        e.winnerSide === 'draw'
          ? 'Match nul'
          : e.winnerSide === 0
            ? 'Toi — Victoire'
            : 'Adversaire — Victoire';
      const icon = e.winnerSide === 'draw' ? '🤝' : '🏆';
      const reason = e.reasonKey ? ` (${frString(e.reasonKey)})` : '';
      return [`> **${icon} ${winner}${reason}**`, ''];
    }
  }
}

// -----------------------------------------------------------------------------
// Move rows
// -----------------------------------------------------------------------------
function renderMove(e: MoveEntry, isResolution: boolean): string[] {
  const out: string[] = [];
  if (e.variant === 'initial-hand') {
    out.push(`- ${side(e)} **Main de départ** (${e.movedCards.length} cartes)`);
    for (const m of e.movedCards) out.push(`    - ${card(m.card)}`);
    out.push('');
    return out;
  }
  if (e.variant === 'draw-phase') {
    for (const m of e.movedCards) {
      out.push(
        `- ${side(e)} **Pioche** : ${card(m.card)} → ${zone(m.destZone)}`,
      );
    }
    out.push('');
    return out;
  }
  out.push(...renderHead(e, isResolution));
  for (const m of e.movedCards) {
    out.push(`    - ${renderMovedCard(m)}`);
  }
  out.push('');
  return out;
}

function renderMovedCard(m: MovedCard): string {
  // `verb` and the zone tags are i18n keys — translate through KEY_TO_FR.
  const verb = frString(m.verb);
  // A position change shows the posture transition rather than a flow arrow.
  if (m.posChange) {
    return `${card(m.card)} — ${verb} : ${m.posChange.from} → ${m.posChange.to}`;
  }
  const dest = m.destCell
    ? `[${m.destCell.player === 0 ? 'Toi' : 'Adv'} ${m.destCell.row}${m.destCell.sequence + 1}]`
    : m.destZone
      ? `[${zone(m.destZone)}]`
      : '';
  const mat = m.isMaterial ? ' _(matériau)_' : '';
  // Origin → destination flow when the source zone is known.
  const from = m.fromZone ? `[${zone(m.fromZone)}] ` : '';
  return `${card(m.card)} : ${from}—${verb}→ ${dest}${mat}`;
}

/** Translate a zone-tag i18n key to its French short label. */
function zone(key: string | undefined): string {
  return key ? frString(key) : '';
}

// -----------------------------------------------------------------------------
// RNG rows
// -----------------------------------------------------------------------------
function renderRng(e: RngEntry, isResolution: boolean): string[] {
  const out = renderHead(e, isResolution);
  const icon = e.rng === 'coin' ? '🪙 Lancé de pièce' : '🎲 Lancé de dé';
  // Coin results are i18n keys (`gameLog.rng.heads/tails`); dice results are
  // plain numeric strings — both pass through `frString` (a number string is
  // not a key, so it is returned verbatim).
  const results = e.results.map(frString).join(', ');
  out.push(`    - ${icon} : ${results}`);
  out.push('');
  return out;
}

// -----------------------------------------------------------------------------
// Combat rows
// -----------------------------------------------------------------------------
function renderCombat(e: CombatEntry, isResolution: boolean): string[] {
  const out = renderHead(e, isResolution);
  const verb = e.combat === 'attack' ? '⚔ Attaque' : '🔥 Calcul de combat';
  if (e.directLabel) {
    out.push(
      `    - ${verb} : ${combatSide(e.attacker)} ${frString(e.directLabel)}`,
    );
  } else if (e.defender) {
    out.push(
      `    - ${verb} : ${combatSide(e.attacker)} vs ${combatSide(e.defender)}`,
    );
  } else {
    out.push(`    - ${verb} : ${combatSide(e.attacker)}`);
  }
  // LP loss — one line per damaged player, omitted entirely when none lost.
  for (const l of e.lpLoss ?? []) {
    const who = l.player === 0 ? 'Toi' : 'Adversaire';
    out.push(`      - 💔 ${who} : −${l.amount} PV`);
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
function renderAction(e: ActionEntry, isResolution: boolean): string[] {
  const out = renderHead(e, isResolution);
  const parts = [`**${frString(e.labelKey)}**`];
  // Counter rows carry a numeric type — compose "Type N" from the i18n key.
  if (e.counterType !== undefined) {
    parts.push(frString('gameLog.action.counterType').replace('{{n}}', String(e.counterType)));
  }
  if (e.counterBadge) parts.push(`\`${e.counterBadge}\``);
  if (e.equipTargets?.length) {
    parts.push('→ ' + e.equipTargets.map(card).join(', '));
  }
  out.push(`    - ${parts.join(' ')}`);
  out.push('');
  return out;
}

// -----------------------------------------------------------------------------
// Shared head rendering (source card + description + chain badge + targets)
// -----------------------------------------------------------------------------
function renderHead(e: RowHead, isResolution: boolean): string[] {
  const out: string[] = [];
  const badge = e.chainLink ? `①②③④⑤⑥⑦⑧⑨⑩`[e.chainLink - 1] ?? `[${e.chainLink}]` : '';
  const negated = e.negated ? ' ~~(NIÉ)~~' : '';
  const head = e.source ? card(e.source) : '_(aucune carte source)_';
  out.push(`- ${side(e)}${badge ? badge + ' ' : ''}${head}${negated}`);
  // Design decision D-C: a resolution row does NOT re-print the effect
  // description — it is identical to the activation row above it in the same
  // chain group. The activation row owns the description.
  if (e.description && !isResolution) {
    out.push(`    > « ${e.description.trim()} »`);
  } else if (!isResolution && e.source && e.chainLink) {
    // Activation with no resolved effect text (OCGCore emitted no
    // disambiguation string) — a generic line keeps the row from looking
    // truncated. Mirrors the panel's `gameLog.activationGeneric`.
    out.push(`    > _active l'effet de ${plainName(e.source)}_`);
  }
  // Targeting is an annotation of the effect, not its own row.
  if (e.targets?.length) {
    out.push(`    ▸ cible : ${e.targets.map(card).join(', ')}`);
  }
  return out;
}

/** Side glyph — blue = you, amber = opponent (design decision D-A: the
 *  opponent is amber, not red; red is reserved for danger). */
function side(e: { player: RelPlayer }): string {
  return e.player === 0 ? '🔵' : '🟠';
}

function card(ref: LogCardRef): string {
  if (!ref.revealed) return '_Carte non révélée_';
  return `**${plainName(ref)}**`;
}

/** The card's display name without Markdown emphasis — for inlining inside an
 *  italic phrase (the generic activation label) where `**` would not nest.
 *  `cardName` is usually a real name, but combat placeholders put an i18n key
 *  here — `frString` resolves a key and returns a real name unchanged. */
function plainName(ref: LogCardRef): string {
  return ref.cardName ? frString(ref.cardName) : `#${ref.cardCode}`;
}
