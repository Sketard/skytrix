import { computed, Injectable, type Signal } from '@angular/core';
import type { Prompt } from '../types';
import type {
  SelectBattleCmdMsg,
  SelectDisfieldMsg,
  SelectIdleCmdMsg,
  SelectPlaceMsg,
} from '../duel-ws.types';
import { LOCATION } from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';
import { duelAssert } from '../../../core/utilities/duel-assert';
import {
  buildActionableCardsFromBattle,
  buildActionableCardsFromIdle,
  isActivateAction,
} from './idle-action-codes';

interface TpResult { goFirst: boolean }
type ChainPhase = 'idle' | 'building' | 'resolving';

interface PromptDerivationConfig {
  pendingPrompt: Signal<Prompt | null>;
  isAnimating: Signal<boolean>;
  queueLength: () => number;
  chainPhase: Signal<ChainPhase>;
  hasPendingChainEntry: () => boolean;
  chainEntryAnimating: Signal<boolean>;
  chainPromptGateActive: Signal<boolean>;
  ownPlayerIndex: Signal<number>;
  waitingForOpponent: Signal<boolean>;
  tpResult: Signal<TpResult | null>;
  rpsResult: () => unknown;
  rpsInProgress: () => boolean;
  ocgPlayerIndex: () => number | null;
}

/**
 * Component-scoped derivation of all prompt-driven UI state. Hosts the
 * 9 computeds that depend only on the prompt + connection signals (no
 * component-owned signals).
 *
 * Two-phase init: the host component calls `configure()` in its
 * constructor with closures reading the relevant signals. In dev mode,
 * unconfigured reads throw via duelAssert — same pattern as DuelContext.
 *
 * Stays out: `effectivePrompt` (depends on cardMenu.pilePrompt — host
 * concern), `zoneBrowserActionableCodes` (depends on the host's
 * zoneBrowserState + zoneIdToLocation method).
 */
@Injectable()
export class PromptDerivationService {
  private _configured = false;
  private cfg: PromptDerivationConfig | null = null;

  configure(config: PromptDerivationConfig): void {
    this._configured = true;
    this.cfg = config;
  }

  private get c(): PromptDerivationConfig {
    duelAssert(this._configured, 'PromptDerivationService',
      'configure() was not called before first read — check component constructor order');
    return this.cfg as PromptDerivationConfig;
  }

  // Story 4.2 — Prompt drain: gate prompt display behind animation queue drain
  // During chain building with pending cost, let cost prompts through immediately
  // (the zone glow continues visually behind the prompt dialog). After cost paid,
  // gate on chainEntryAnimating so the overlay entry animation plays before
  // SELECT_CHAIN appears.
  readonly visiblePrompt = computed(() => {
    const c = this.c;
    const animating = c.isAnimating();
    const chainEntryAnim = c.chainEntryAnimating();
    const prompt = c.pendingPrompt();
    const queuePending = c.queueLength() > 0;
    const chainPromptGate = c.chainPromptGateActive();
    const blocked = animating || chainEntryAnim || queuePending || chainPromptGate;
    if (!blocked) return prompt;
    if (c.chainPhase() === 'building' && c.hasPendingChainEntry()
      && !animating && !queuePending) {
      return prompt;
    }
    return null;
  });

  // Story 1.7 — Actionable prompt (IDLECMD/BATTLECMD distributed UI)
  readonly actionablePrompt = computed((): SelectIdleCmdMsg | SelectBattleCmdMsg | null => {
    const p = this.visiblePrompt();
    if (p?.type === 'SELECT_IDLECMD' || p?.type === 'SELECT_BATTLECMD') return p;
    return null;
  });

  // Has active blocking prompt — excludes IDLECMD/BATTLECMD (distributed UI, not blocking).
  readonly hasActivePrompt = computed(() => {
    const p = this.visiblePrompt();
    return p !== null && p.type !== 'SELECT_IDLECMD' && p.type !== 'SELECT_BATTLECMD';
  });

  // Zone highlight (Pattern A — SELECT_PLACE / SELECT_DISFIELD)
  readonly isZoneHighlightActive = computed(() => {
    const p = this.visiblePrompt();
    return p?.type === 'SELECT_PLACE' || p?.type === 'SELECT_DISFIELD';
  });

  readonly highlightedZones = computed((): ReadonlySet<string> => {
    const p = this.visiblePrompt();
    if (p?.type !== 'SELECT_PLACE' && p?.type !== 'SELECT_DISFIELD') return new Set<string>();
    const places = (p as SelectPlaceMsg | SelectDisfieldMsg).places;
    const ownIdx = this.c.ownPlayerIndex();
    const keys = places
      .map(pl => {
        const zoneId = locationToZoneId(pl.location, pl.sequence);
        const relPlayer = pl.player === ownIdx ? 0 : 1;
        return zoneId ? `${zoneId}-${relPlayer}` : null;
      })
      .filter((k): k is string => k !== null);
    return new Set(keys);
  });

  readonly zoneInstruction = computed(() => {
    const p = this.visiblePrompt();
    if (p?.type === 'SELECT_PLACE') return 'Select a zone to place your card';
    if (p?.type === 'SELECT_DISFIELD') return 'Select a zone to destroy';
    return '';
  });

  // Story 1.7 — Hand actionable indices (all actions, for click behavior)
  readonly playerActionableHandIndices = computed((): Set<number> => {
    const prompt = this.actionablePrompt();
    if (!prompt) return new Set();
    const actionMap = prompt.type === 'SELECT_IDLECMD'
      ? buildActionableCardsFromIdle(prompt)
      : buildActionableCardsFromBattle(prompt);
    const indices = new Set<number>();
    for (const key of actionMap.keys()) {
      const parts = key.split('-');
      if (parseInt(parts[0], 10) === LOCATION.HAND) {
        indices.add(parseInt(parts[1], 10));
      }
    }
    return indices;
  });

  // Hand indices with activate effect (gold glow)
  readonly playerActivateHandIndices = computed((): Set<number> => {
    const prompt = this.actionablePrompt();
    if (!prompt) return new Set();
    const promptType = prompt.type as 'SELECT_IDLECMD' | 'SELECT_BATTLECMD';
    const actionMap = prompt.type === 'SELECT_IDLECMD'
      ? buildActionableCardsFromIdle(prompt)
      : buildActionableCardsFromBattle(prompt);
    const indices = new Set<number>();
    for (const [key, actions] of actionMap) {
      const parts = key.split('-');
      if (parseInt(parts[0], 10) === LOCATION.HAND
        && actions.some(a => isActivateAction(a.actionCode, promptType))) {
        indices.add(parseInt(parts[1], 10));
      }
    }
    return indices;
  });

  // TP passive message: shown in prompt dialog during turn-order phase
  readonly tpPassiveMessage = computed(() => {
    const c = this.c;
    const tpResult = c.tpResult();
    if (tpResult) return {
      title: tpResult.goFirst ? 'You go first!' : 'You go second!',
      subtitle: 'The duel will begin shortly',
      style: 'result' as const,
    };
    // Pre-duel waiting (loser waits for winner to choose TP)
    const waiting = c.waitingForOpponent();
    const preDuel = c.ocgPlayerIndex() === null;
    const noPrompt = !c.pendingPrompt();
    const noRps = !c.rpsResult() && !c.rpsInProgress();
    if (waiting && preDuel && noPrompt && noRps) return {
      title: 'Opponent is choosing turn order...',
      style: 'waiting' as const,
    };
    return null;
  });
}
