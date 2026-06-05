import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostBinding,
  HostListener,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { PromptSubComponent } from '../prompt.types';
import { HintContext } from '../../../types';
import { CardInfo, CardLocation, LOCATION, SelectCardMsg, SelectChainMsg, SelectTributeMsg, SelectSumMsg, SelectUnselectCardMsg } from '../../../duel-ws.types';
import { TranslatePipe } from '@ngx-translate/core';
import { CardNamePipe } from '../../../../../core/pipes/card-i18n.pipe';
import { isFaceUp } from '../../../pvp-card.utils';
import { DuelCardArtService } from '../../duel-card-art.service';
import { DuelSystemStringsService } from '../../../duel-system-strings.service';
import { resolveDescription } from '../../../duel-description.util';
import { CardDataCacheService } from '../../card-data-cache.service';
import { DuelLogger, DuelLogCategory } from '../../duel-logger';
import { getZoneIconPath, getZoneDisplayOrder } from '../../../zone-icons';
import { PillComponent } from '../../../../../components/pill/pill.component';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { LongPressDirective } from '../../long-press.directive';

type CardGridPrompt = SelectCardMsg | SelectChainMsg | SelectTributeMsg | SelectSumMsg | SelectUnselectCardMsg;

interface DisplayEntry {
  card: CardInfo;
  originalIndex: number;
}

interface ZoneGroup {
  location: CardLocation;
  iconPath: string;
  entries: DisplayEntry[];
  groupKey: string;
  /** `true` when the group's cards belong to the viewer, `false` for the opponent. */
  isOwn: boolean;
}

function isFieldZone(loc: CardLocation): boolean {
  return loc === LOCATION.MZONE || loc === LOCATION.SZONE;
}

function cardKey(c: CardInfo): string {
  return `${c.player}-${c.location}-${c.sequence}-${c.cardCode}`;
}

@Component({
  selector: 'app-prompt-card-grid',
  templateUrl: './prompt-card-grid.component.html',
  styleUrl: './prompt-card-grid.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, CardNamePipe, PillComponent, CdkOverlayOrigin, CdkConnectedOverlay, LongPressDirective],
})
export class PromptCardGridComponent implements PromptSubComponent<CardGridPrompt>, OnInit {
  private readonly artService = inject(DuelCardArtService);
  private readonly systemStrings = inject(DuelSystemStringsService);
  private readonly cardDataCache = inject(CardDataCacheService);
  private readonly duelLogger = inject(DuelLogger);

  promptData: CardGridPrompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();
  @HostBinding('class.read-only') readOnly = false;
  preSelectedResponse: unknown = undefined;
  longPressInspect = new EventEmitter<{ cardCode: number }>();
  preTargetCards = new EventEmitter<CardInfo[]>();
  excludedCards: CardInfo[] = [];
  revealedCards: CardInfo[] = [];
  /** Cards revealed by MSG_CONFIRM_CARDS — keyed by "location-player-sequence" to show face-up even if position is face-down. */
  confirmedCardKeys = new Set<string>();
  ownPlayerIndex = 0;

  readonly selectedIndices = signal<Set<number>>(new Set());
  /** For SELECT_SUM: tracks each selected card's chosen contribution amount. */
  readonly selectedCardAmounts = signal<Map<number, number>>(new Map());
  /** For SELECT_UNSELECT_CARD: the card index the user just toggled (delta to send to engine), or null if confirming as-is. */
  readonly toggledIndex = signal<number | null>(null);
  /** True when the replay response was a cancel action (empty indices / null index). */
  cancelSelected = false;
  answered = false;

  /**
   * SELECT_CHAIN effect text, keyed by the entry's `description` code. The
   * server emits the raw 64-bit code; resolution is client-side (FR/EN).
   * Card-text descriptions resolve asynchronously via the card-data path,
   * so this is a signal the template re-reads.
   */
  private readonly resolvedDescriptions = signal<ReadonlyMap<number, string>>(new Map());

  ngOnInit(): void {
    if (this.promptData?.type === 'SELECT_CHAIN') {
      void this.resolveChainDescriptions();
    }
    if (this.promptData?.type === 'SELECT_TRIBUTE') {
      const p = this.promptData as SelectTributeMsg;
      this.duelLogger.log(DuelLogCategory.PIPELINE, '[SELECT_TRIBUTE] cards=%d min=%d max=%d excluded=%d cards=%o',
        p.cards.length, p.min, p.max, this.excludedCards.length,
        p.cards.map((c, i) => ({ i, name: c.name, amount: c.amount ?? 1, loc: c.location, seq: c.sequence })));
    }
    this.duelLogger.log(DuelLogCategory.PIPELINE, '[PromptCardGrid] type=%s cards=%d excluded=%d displayEntries=%d',
      this.promptData?.type, this.cards.length, this.excludedCards.length, this.displayEntries.length);

    if (this.readOnly && this.preSelectedResponse != null) {
      const r = this.preSelectedResponse as Record<string, unknown>;
      // Server sends "indicies" (legacy typo) — accept both spellings
      const arr = (r['indices'] ?? r['indicies']) as number[] | undefined;
      if (Array.isArray(arr)) {
        if (arr.length === 0) {
          this.cancelSelected = true;
        } else {
          this.selectedIndices.set(new Set<number>(arr));
        }
      } else if (r['index'] === null) {
        this.cancelSelected = true;
      } else if (r['index'] != null && (r['index'] as number) >= 0) {
        this.selectedIndices.set(new Set<number>([r['index'] as number]));
      }
      this.answered = true;
      return;
    }

    // Pre-highlight cards already in the engine's material group (unselect_cards section).
    if (this.promptData?.type === 'SELECT_UNSELECT_CARD') {
      const p = this.promptData as SelectUnselectCardMsg;
      const selectCount = p.selectCount ?? 0;
      const preSelected = new Set<number>();
      for (let i = selectCount; i < p.cards.length; i++) preSelected.add(i);
      this.selectedIndices.set(preSelected);
    }
  }

  get cards(): CardInfo[] {
    if (!this.promptData) return [];
    // For SELECT_SUM, combine mustSelect + optional into a single selectable pool.
    // mustSelect is the primary pool (not auto-included), player picks from it.
    if (this.promptData.type === 'SELECT_SUM') {
      const p = this.promptData as SelectSumMsg;
      return [...(p.mustSelect ?? []), ...(p.cards ?? [])];
    }
    return this.promptData.cards ?? [];
  }

  get displayEntries(): DisplayEntry[] {
    const all = this.cards;

    if (this.excludedCards.length === 0) {
      return all.map((card, i) => ({ card, originalIndex: i }));
    }
    const excludedKeys = new Set(this.excludedCards.map(cardKey));
    // Track used keys to handle duplicates correctly (only exclude once per excluded card)
    const usedKeys = new Map<string, number>();
    for (const k of excludedKeys) usedKeys.set(k, 0);

    return all.reduce<DisplayEntry[]>((acc, card, i) => {
      const k = cardKey(card);
      if (excludedKeys.has(k)) {
        const used = usedKeys.get(k)!;
        const total = this.excludedCards.filter(c => cardKey(c) === k).length;
        if (used < total) {
          usedKeys.set(k, used + 1);
          return acc; // skip this card
        }
      }
      acc.push({ card, originalIndex: i });
      return acc;
    }, []);
  }

  get zoneGroups(): ZoneGroup[] {
    const entries = this.displayEntries;
    const map = new Map<string, DisplayEntry[]>();
    for (const entry of entries) {
      // Always group by player + location so the owner of a group is unambiguous
      // (a SELECT_CHAIN spanning both GYs, a SELECT_CARD targeting cards in both
      // hands, etc. would otherwise merge into a single ownerless group).
      const key = `${entry.card.player}-${entry.card.location}`;
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    return Array.from(map.entries())
      .map(([key, groupEntries]) => {
        const [playerStr, locStr] = key.split('-');
        const location = Number(locStr) as CardLocation;
        const player = Number(playerStr);
        const isOwn = player === this.ownPlayerIndex;
        if (isFieldZone(location)) {
          // Opponent's field reads right-to-left from the viewer's perspective.
          groupEntries.sort((a, b) =>
            isOwn ? a.card.sequence - b.card.sequence : b.card.sequence - a.card.sequence,
          );
        } else {
          groupEntries.sort((a, b) => b.card.name.localeCompare(a.card.name));
        }
        return {
          location,
          groupKey: key,
          iconPath: getZoneIconPath(location),
          entries: groupEntries,
          isOwn,
        };
      })
      // Own groups first within the same zone, then by canonical zone order.
      .sort((a, b) => {
        const za = getZoneDisplayOrder(a.location);
        const zb = getZoneDisplayOrder(b.location);
        if (za !== zb) return za - zb;
        return (a.isOwn ? 0 : 1) - (b.isOwn ? 0 : 1);
      });
  }

  get isMultiSelect(): boolean {
    const t = this.promptData?.type;
    if (t === 'SELECT_CARD') return this.maxSelect > 1;
    return t === 'SELECT_TRIBUTE' || t === 'SELECT_SUM' || t === 'SELECT_UNSELECT_CARD';
  }

  get minSelect(): number {
    const p = this.promptData;
    if (!p) return 1;
    if (p.type === 'SELECT_SUM') return (p as SelectSumMsg).minCards;
    // For SELECT_TRIBUTE min/max are tribute counts, not card counts — use 1 as card-count floor
    if (p.type === 'SELECT_TRIBUTE') return 1;
    if ('min' in p) return (p as { min: number }).min;
    return 1;
  }

  get sumTarget(): number {
    if (this.promptData?.type !== 'SELECT_SUM') return 0;
    return (this.promptData as SelectSumMsg).targetSum;
  }

  get maxSelect(): number {
    const p = this.promptData;
    if (!p) return 1;
    if (p.type === 'SELECT_SUM') {
      const sum = p as SelectSumMsg;
      // selectMax is a mode flag (0=exact, 1=at-least), NOT a card count
      if (sum.maxCards > 0) return sum.maxCards;
      return this.cards.length;
    }
    // For SELECT_TRIBUTE max is a tribute count — any card count up to total cards is valid
    if (p.type === 'SELECT_TRIBUTE') return this.cards.length;
    if ('max' in p) return p.max;
    return 1;
  }

  /** For SELECT_SUM: total sum of currently selected cards (uses chosen amounts). */
  get selectedSum(): number {
    if (this.promptData?.type !== 'SELECT_SUM') return 0;
    let sum = 0;
    for (const amount of this.selectedCardAmounts().values()) sum += amount;
    return sum;
  }

  get isToggleMode(): boolean {
    return this.promptData?.type === 'SELECT_UNSELECT_CARD';
  }

  get canFinish(): boolean {
    if (this.promptData?.type === 'SELECT_UNSELECT_CARD') {
      return this.promptData.canFinish;
    }
    return false;
  }

  get canCancel(): boolean {
    const p = this.promptData;
    if (!p) return false;
    if (p.type === 'SELECT_CHAIN') return !p.forced;
    if ('cancelable' in p) return (p as SelectCardMsg).cancelable;
    return false;
  }

  /** Sum of tribute amounts of currently selected cards (SELECT_TRIBUTE). */
  get selectedTributeSum(): number {
    if (this.promptData?.type !== 'SELECT_TRIBUTE') return 0;
    let sum = 0;
    for (const idx of this.selectedIndices()) {
      const card = this.cards[idx];
      sum += card?.amount ?? 1;
    }
    return sum;
  }

  get isConfirmEnabled(): boolean {
    const count = this.selectedIndices().size;
    if (this.isToggleMode) return this.canFinish || this.toggledIndex() !== null;
    if (this.promptData?.type === 'SELECT_SUM') {
      const p = this.promptData as SelectSumMsg;
      return this.selectedSum >= p.targetSum;
    }
    if (this.promptData?.type === 'SELECT_TRIBUTE') {
      const p = this.promptData as SelectTributeMsg;
      return this.selectedTributeSum >= p.min && this.selectedTributeSum <= p.max;
    }
    if (this.isMultiSelect) return count >= this.minSelect && count <= this.maxSelect;
    return count === 1;
  }

  private static readonly CARD_BACK = 'assets/images/card_back.jpg';

  getCardImageUrl(card: CardInfo): string {
    if (card.position != null && !isFaceUp(card.position) && card.player !== this.ownPlayerIndex) {
      const key = `${card.location}-${card.player}-${card.sequence}`;
      if (!this.confirmedCardKeys.has(key)) return PromptCardGridComponent.CARD_BACK;
    }
    return this.artService.resolveUrl(card.cardCode);
  }

  /**
   * Memoised effectBadge map, keyed by originalIndex. `promptData` and
   * `excludedCards` are both immutable for the component's lifetime (the dialog
   * swaps the whole component on a new prompt), so caching on `promptData`
   * identity is sufficient — the getter is otherwise O(n) per template call.
   */
  private _effectBadgeCache: { prompt: CardGridPrompt; map: Map<number, number> } | null = null;

  /**
   * For SELECT_CHAIN: maps each `originalIndex` of a card listed 2+ times to its
   * 1-based ordinal. Grouped by *physical card identity* (`cardKey` —
   * player+location+sequence+cardCode), NOT cardCode alone: a second copy of
   * the same card elsewhere on the board (e.g. one in hand, one on field)
   * shares the cardCode but is a distinct card with a single effect — it must
   * NOT get a badge. Only the same physical card offering multiple chainable
   * effects is a real duplicate. Built over `displayEntries` so an excluded
   * entry does not leave a numbering gap; the loop preserves OCGCore order.
   */
  private get effectBadgeMap(): Map<number, number> {
    const prompt = this.promptData;
    if (prompt?.type !== 'SELECT_CHAIN') return new Map();
    if (this._effectBadgeCache?.prompt === prompt) return this._effectBadgeCache.map;
    const entries = this.displayEntries;
    const counts = new Map<string, number>();
    for (const e of entries) {
      const k = cardKey(e.card);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    const map = new Map<number, number>();
    for (const e of entries) {
      const k = cardKey(e.card);
      if ((counts.get(k) ?? 0) < 2) continue;
      const ordinal = (seen.get(k) ?? 0) + 1;
      seen.set(k, ordinal);
      map.set(e.originalIndex, ordinal);
    }
    this._effectBadgeCache = { prompt, map };
    return map;
  }

  /** The 1-based effect ordinal for a chain entry, or null when it has no duplicate. */
  effectBadge(originalIndex: number): number | null {
    return this.effectBadgeMap.get(originalIndex) ?? null;
  }

  /**
   * Resolves each SELECT_CHAIN entry's `description` code to localized text.
   * System strings (`cardCode == 0`) resolve synchronously; card-text
   * descriptions resolve to the card's localized name via the Spring Boot
   * card-data path. Keyed by the code so duplicate codes share one entry.
   */
  private async resolveChainDescriptions(): Promise<void> {
    const codes = [...new Set(
      this.cards.map(c => c.description).filter((d): d is number => !!d),
    )];
    if (codes.length === 0) return;
    const deps = { resolveSystemString: (i: number) => this.systemStrings.resolveSystemString(i) };
    await this.systemStrings.preload();
    const entries = await Promise.all(
      codes.map(async (code): Promise<[number, string]> => {
        const result = resolveDescription(code, deps);
        if (result.kind === 'system') return [code, result.text];
        const card = await this.cardDataCache.getCardData(result.cardCode);
        return [code, card.name ?? ''];
      }),
    );
    this.resolvedDescriptions.set(new Map(entries.filter(([, text]) => text)));
  }

  /** Effect text for the hover panel, or null when unavailable (empty / unresolved). */
  effectTitle(card: CardInfo): string | null {
    if (!card.description) return null;
    return this.resolvedDescriptions().get(card.description) ?? null;
  }

  /**
   * `originalIndex` of the chain entry whose effect hover panel is open, or
   * null. The panel uses a CDK connected overlay (`cdkConnectedOverlay`) so it
   * escapes both the `overflow-x: auto` card strip AND the `transform` on the
   * prompt dialog — a plain `position: fixed` re-anchors to the transformed
   * ancestor and lands off-screen.
   */
  readonly hoverIndex = signal<number | null>(null);

  /** Above-the-origin first, flipping below when there is no room (CDK handles the choice). */
  readonly hoverPositions: ConnectedPosition[] = [
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
  ];

  /** Effect text of the currently hovered entry, or null. */
  hoverText(): string | null {
    const idx = this.hoverIndex();
    return idx == null ? null : this.effectTitle(this.cards[idx]);
  }

  onCardHover(originalIndex: number): void {
    // Hover applies to every SELECT_CHAIN entry with effect text — not only
    // duplicates. The pill stays duplicate-only; the hover is general reading aid.
    if (this.promptData?.type !== 'SELECT_CHAIN') return;
    if (!this.effectTitle(this.cards[originalIndex])) return;
    this.hoverIndex.set(originalIndex);
  }

  onCardLeave(): void {
    this.hoverIndex.set(null);
  }

  // --- Touch long-press + right-click → inspect or effect panel --------------
  // Direction B (Master Duel-style, 2026-06-05). Touch long-press and
  // right-click both target the inspector, except inside SELECT_CHAIN where
  // long-press keeps its legacy "open effect panel" role (cards that carry
  // effect text — pre-existing UX since chains can have multiple effects per
  // card). When the long-press fires, `longPressFired` is set so the trailing
  // synthetic click on `toggleCard` skips selection. The `LongPressDirective`
  // suppresses the click at the DOM level too, but `consumeLongPress` is the
  // safety net for keyboard / programmatic invocations.
  private longPressFired = false;

  onCardLongPress(originalIndex: number): void {
    this.longPressFired = true;
    if (this.promptData?.type === 'SELECT_CHAIN' && this.effectTitle(this.cards[originalIndex])) {
      // Legacy SELECT_CHAIN effect-panel path on touch — desktop uses mouseenter / mouseleave.
      this.onCardHover(originalIndex);
      return;
    }
    const cardCode = this.cards[originalIndex]?.cardCode;
    if (cardCode) this.longPressInspect.emit({ cardCode });
  }

  onCardContextMenu(originalIndex: number, event: MouseEvent): void {
    event.preventDefault();
    const cardCode = this.cards[originalIndex]?.cardCode;
    if (cardCode) this.longPressInspect.emit({ cardCode });
  }

  /** True right after a long press — `toggleCard` checks this to skip selection. */
  consumeLongPress(): boolean {
    if (!this.longPressFired) return false;
    this.longPressFired = false;
    return true;
  }

  isSelected(index: number): boolean {
    if (this.promptData?.type === 'SELECT_SUM') return this.selectedCardAmounts().has(index);
    return this.selectedIndices().has(index);
  }

  // OCGCore encodes dual-use cards as: low 16 bits = min (1), high 16 bits = max (link rating).
  private getAmountMin(card: CardInfo): number { return (card.amount ?? 1) & 0xFFFF; }
  private getAmountMax(card: CardInfo): number {
    const hi = (card.amount ?? 1) >>> 16;
    return hi !== 0 ? hi : this.getAmountMin(card);
  }
  isDualAmount(card: CardInfo): boolean { return this.getAmountMin(card) !== this.getAmountMax(card); }
  getSelectedAmount(index: number): number { return this.selectedCardAmounts().get(index) ?? 1; }

  /**
   * Double-click handler. Two regimes co-exist :
   * - SELECT_CHAIN : `dblclick` = inspect (Direction B, Master Duel-style).
   *   Single-tap selects a chain link; long-press / right-click opens the
   *   effect panel — there is no "select + confirm" shortcut for chains.
   * - Other prompts : `dblclick` = select + confirm in one gesture (legacy).
   */
  dblclickCard(index: number): void {
    if (this.answered || this.readOnly) return;
    if (this.promptData?.type === 'SELECT_CHAIN') {
      const cardCode = this.cards[index]?.cardCode;
      if (cardCode) this.longPressInspect.emit({ cardCode });
      return;
    }
    if (this.isMultiSelect || this.isToggleMode) return;
    if (this.promptData?.type === 'SELECT_SUM' || this.promptData?.type === 'SELECT_TRIBUTE') return;
    if (!this.isSelected(index)) this.toggleCard(index);
    if (this.isConfirmEnabled) this.confirm();
  }

  toggleCard(index: number): void {
    if (this.answered) return;
    // A long press fired (effect panel or inspect) — the trailing click must not select.
    if (this.consumeLongPress()) return;
    // Direction B (Master Duel-style, 2026-06-05) : tap = select only, never
    // inspect. The inspector now opens via long-press / right-click / dblclick
    // (SELECT_CHAIN) only — routed through `onCardLongPress` /
    // `onCardContextMenu` / `dblclickCard`.
    if (this.readOnly) return;

    if (this.promptData?.type === 'SELECT_SUM') {
      const p = this.promptData as SelectSumMsg;
      this.selectedCardAmounts.update(map => {
        const next = new Map(map);
        const card = this.cards[index];
        if (!card) return map;
        const amtMin = this.getAmountMin(card);
        const amtMax = this.getAmountMax(card);
        const currentAmt = next.get(index);
        if (currentAmt === undefined) {
          // Unselected → select with max amount (link rating or 1 for normal monsters)
          if (next.size >= this.maxSelect) return map;
          // In exact mode (selectMax=0), prevent overshooting the target sum.
          // In at-least mode (selectMax=1), allow adding cards even after reaching the target.
          const currentSum = Array.from(next.values()).reduce((s, a) => s + a, 0);
          if (p.selectMax === 0 && currentSum >= p.targetSum) return map;
          next.set(index, amtMax);
        } else if (amtMin !== amtMax && currentAmt !== amtMin) {
          // Dual-amount card selected at max → toggle down to min (use as single monster)
          next.set(index, amtMin);
        } else {
          // Selected at min (or non-dual) → deselect
          next.delete(index);
        }
        return next;
      });
      return;
    }
    if (this.promptData?.type === 'SELECT_UNSELECT_CARD') {
      const p = this.promptData as SelectUnselectCardMsg;
      const selectCount = p.selectCount ?? 0;
      const isPreSelected = index >= selectCount; // card is already in engine's material group
      const newToggled = this.toggledIndex() === index ? null : index;
      this.toggledIndex.set(newToggled);
      // Rebuild visual selection: start from engine pre-selection, then apply the pending toggle
      this.selectedIndices.update(() => {
        const next = new Set<number>();
        for (let i = selectCount; i < p.cards.length; i++) next.add(i); // restore pre-selected
        if (newToggled !== null) {
          if (isPreSelected) next.delete(newToggled); // removing from group
          else next.add(newToggled);                  // adding to group
        }
        return next;
      });
      return;
    }
    this.selectedIndices.update(set => {
      const next = new Set(set);
      if (next.has(index)) {
        next.delete(index);
      } else {
        if (!this.isMultiSelect && !this.isToggleMode) {
          next.clear();
        }
        if (this.promptData?.type === 'SELECT_TRIBUTE') {
          // Block adding more cards once the tribute count requirement is already met
          const p = this.promptData as SelectTributeMsg;
          const currentSum = Array.from(next).reduce((s, i) => s + (this.cards[i]?.amount ?? 1), 0);
          if (currentSum >= p.max) return set;
        } else if (this.isMultiSelect && next.size >= this.maxSelect) {
          return set;
        }
        next.add(index);
      }
      return next;
    });

    const selected = Array.from(this.selectedIndices())
      .map(i => this.cards[i])
      .filter(Boolean);
    this.preTargetCards.emit(selected);
  }

  /** True when SELECT_SUM minimum is met (confirm enabled). Drives the two-button layout. */
  get isSumReady(): boolean {
    return this.promptData?.type === 'SELECT_SUM' && this.isConfirmEnabled;
  }

  /** True when more cards can still be added to the SELECT_SUM selection. */
  get canAddMoreMaterials(): boolean {
    const selectedCount = this.selectedCardAmounts().size;
    return selectedCount < this.cards.length && selectedCount < this.maxSelect;
  }

  /** Finish the SELECT_UNSELECT_CARD selection without toggling any card (sends null). */
  confirmFinish(): void {
    if (this.answered) return;
    this.answered = true;
    this.response.emit({ index: null });
  }

  cancel(): void {
    if (this.answered || !this.canCancel) return;
    this.answered = true;
    const type = this.promptData?.type;
    if (type === 'SELECT_CHAIN') {
      this.response.emit({ index: null });
    } else {
      this.response.emit({ indices: [] });
    }
  }

  confirm(): void {
    if (this.answered || !this.isConfirmEnabled) return;
    this.answered = true;

    const type = this.promptData?.type;

    if (type === 'SELECT_SUM') {
      const indices = Array.from(this.selectedCardAmounts().keys());
      this.response.emit({ indices });
      return;
    }

    const indices = Array.from(this.selectedIndices());
    // SELECT_CHAIN and SELECT_UNSELECT_CARD use { index } (single)
    if (type === 'SELECT_UNSELECT_CARD') {
      const idx = this.toggledIndex();
      this.duelLogger.log(DuelLogCategory.PIPELINE, '[PromptCardGrid] SELECT_UNSELECT_CARD confirm: toggledIndex=%o card=%o canFinish=%s',
        idx, idx != null ? this.cards[idx] : null, (this.promptData as SelectUnselectCardMsg)?.canFinish);
      this.response.emit({ index: idx });
    } else if (type === 'SELECT_CHAIN') {
      this.response.emit({ index: indices[0] ?? null });
    } else {
      if (type === 'SELECT_TRIBUTE') {
        const tributeSum = indices.reduce((s, i) => s + (this.cards[i]?.amount ?? 1), 0);
        this.duelLogger.log(DuelLogCategory.PIPELINE, '[SELECT_TRIBUTE] confirm indices=%o tributeSum=%d', indices, tributeSum);
      }
      this.response.emit({ indices });
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.readOnly) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirm();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    }
  }
}
