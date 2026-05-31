import {
  ChangeDetectionStrategy,
  Component,
  computed,
  createComponent,
  effect,
  ElementRef,
  EnvironmentInjector,
  HostListener,
  inject,
  Injector,
  input,
  AfterViewInit,
  OnDestroy,
  output,
  signal,
  Type,
  untracked,
  ViewChild,
} from '@angular/core';
import { CdkPortalOutlet, ComponentPortal } from '@angular/cdk/portal';
import { CdkTrapFocus, LiveAnnouncer } from '@angular/cdk/a11y';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DuelWebSocketService, ResponseData } from '../../duel-web-socket.service';
import {
  AUTO_SELECT_PROMPT_TYPES,
  IGNORED_PROMPT_TYPES,
  PROMPT_COMPONENT_MAP,
  PromptSubComponent,
} from '../prompt.types';
import { Prompt, HintContext } from '../../../types';
import { CardInfo, LOCATION } from '../../../duel-ws.types';
import { PromptActionListReadonlyComponent } from '../prompt-action-list-readonly/prompt-action-list-readonly.component';
import { DuelSystemStringsService } from '../../../duel-system-strings.service';
import { decodeDescription, resolveDescription } from '../../../duel-description.util';
import {
  HintResolveDeps,
  KNOWN_HINT_TYPES,
  resolveHintAction,
  resolveHintTimingLabel,
} from '../../../duel-hint.util';
import { getAttributeName, getRaceName } from '../../../pvp-alteration.utils';
import { CardDataCacheService } from '../../card-data-cache.service';
import { DuelLogger, DuelLogCategory } from '../../duel-logger';
import '../prompt-registry'; // side-effect: populates PROMPT_COMPONENT_MAP

function isExcavatedCard(c: CardInfo): boolean {
  return c.location === LOCATION.DECK || c.location === LOCATION.EXTRA;
}

/**
 * M22 — Pick the chainIndex of the link the dialog should read its reveals
 * from. Priority: a link with `resolving: true` (a CHAIN_SOLVING fired for it,
 * its CONFIRMs land under that index server-side); else the last activeChainLink
 * (chain still building, prompt arriving for the about-to-resolve link);
 * else null (no chain — cost prompt outside resolution).
 *
 * Exported for unit testing — pure function.
 */
export function selectCurrentChainLinkIndex(
  links: ReadonlyArray<{ chainIndex: number; resolving: boolean }>,
): number | null {
  const resolving = links.find(l => l.resolving);
  if (resolving) return resolving.chainIndex;
  if (links.length > 0) return links[links.length - 1].chainIndex;
  return null;
}

/**
 * Filter for the REVEALED CARDS panel. Strictly excavate (DECK/EXTRA).
 * Hand-reveal prompts (Aqua Dolphin) render the opponent's hand in the
 * sub-component itself; they MUST NOT bleed into this panel.
 *
 * Exported for unit testing — pure function.
 */
export function selectExcavatedReveals(allConfirmed: ReadonlyArray<CardInfo>): CardInfo[] {
  return allConfirmed.filter(isExcavatedCard);
}

export type DialogState = 'closed' | 'open' | 'collapsed';

export interface PassiveMessage {
  title: string;
  subtitle?: string;
  style: 'waiting' | 'result';
}

@Component({
  selector: 'app-pvp-prompt-dialog',
  templateUrl: './pvp-prompt-dialog.component.html',
  styleUrl: './pvp-prompt-dialog.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkPortalOutlet, CdkTrapFocus, TranslatePipe],
})
export class PvpPromptDialogComponent implements AfterViewInit, OnDestroy {
  private readonly wsService = inject(DuelWebSocketService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly injector = inject(Injector);
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly translate = inject(TranslateService);
  private readonly systemStrings = inject(DuelSystemStringsService);
  private readonly cardDataCache = inject(CardDataCacheService);
  private readonly duelLogger = inject(DuelLogger);

  @ViewChild(CdkPortalOutlet) portalOutlet!: CdkPortalOutlet;

  readonly prompt = input<Prompt | null>(null);
  readonly passiveMessage = input<PassiveMessage | null>(null);
  readonly responseOverride = input<((data: unknown) => void) | null>(null);
  readonly ownPlayerIndex = input(0);
  /** Replay mode: override hint context (replaces wsService.hintContext()). */
  readonly hintContext = input<HintContext | null>(null);
  /** Replay mode: override confirmed/excavated cards (replaces wsService.lastConfirmedCards). */
  readonly confirmedCards = input<CardInfo[] | null>(null);
  /** Replay mode: marks all sub-components as non-interactive. */
  readonly readOnly = input(false);
  /** Replay mode: the response that was chosen (highlights the selected option). */
  readonly preSelectedResponse = input<unknown>(undefined);

  readonly dialogState = signal<DialogState>('closed');
  readonly hintText = signal<string | null>(null);
  readonly isSending = signal(false);

  readonly isDialogVisible = computed(() => this.dialogState() !== 'closed');
  readonly trapFocusActive = computed(() => this.dialogState() === 'open');

  readonly dialogExpanded = output<boolean>();
  readonly longPressInspect = output<{ cardCode: number }>();
  readonly preTargetCards = output<CardInfo[]>();

  private pendingAttach: { prompt: Prompt; componentType: Type<PromptSubComponent> } | null = null;
  private responseSubscription: { unsubscribe(): void } | null = null;
  private longPressSubscription: { unsubscribe(): void } | null = null;
  private preTargetSubscription: { unsubscribe(): void } | null = null;
  private langChangeSubscription: { unsubscribe(): void } | null = null;

  constructor() {
    // Warm the FR/EN system-string tables so prompt descriptions resolve
    // synchronously when the first SELECT_* prompt arrives.
    void this.systemStrings.preload();

    // Re-localize the hint banner of an open prompt when the UI language
    // changes — the hint action / timing label are resolved client-side.
    this.langChangeSubscription = this.translate.onLangChange.subscribe(() => {
      const prompt = this.prompt();
      if (prompt && this.dialogState() !== 'closed') this.refreshHintText(prompt);
    });

    // Consolidated dialog lifecycle: reacts to prompt, passiveMessage, and
    // pre-duel dice-in-progress changes. Single effect avoids ordering
    // issues when multiple signals change simultaneously.
    effect(() => {
      const prompt = this.prompt();
      const msg = this.passiveMessage();
      const diceIp = this.wsService.diceInProgress();
      untracked(() => {
        // F-bugB (2026-05-31) — drop the "Sending…" indicator whenever there
        // is no active prompt, unconditionally. The flag is set true on submit
        // (`onConfirm`) and was only reset when a NEW prompt arrived
        // (`openForPrompt`) or in the passive branch below. If the server
        // accepts a decline but sends NO follow-up prompt for this slot (the
        // SOLO SELECT_CHAIN re-offer loop ending on a decline — the engine
        // stops re-offering), neither path fired and the modal stuck on
        // "Sending…" until the server timeout. A cleared prompt now always
        // releases the indicator.
        if (!prompt) this.isSending.set(false);
        if (prompt) {
          this.onPromptChange(prompt);
        } else if (msg) {
          this.hintText.set(null);
          this.detachComponent();
          if (this.dialogState() === 'closed') {
            this.dialogState.set('open');
          }
        } else if (!diceIp && !this.wsService.firstPlayerResponseSent()) {
          // No prompt, no passive message, dice resolved → close
          if (this.dialogState() !== 'closed') this.closeDialog();
        } else {
          // Dice or first-player choice in progress with no prompt/passive
          this.onPromptChange(null);
        }
      });
    });

    effect(() => {
      const s = this.dialogState();
      untracked(() => this.dialogExpanded.emit(s === 'open'));
    });
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (this.dialogState() === 'closed') return;

    const tag = (event.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    switch (event.key) {
      case 'c':
      case 'C':
        event.preventDefault();
        this.toggleCollapse();
        break;
      case ' ':
        event.preventDefault();
        (this.elementRef.nativeElement.querySelector('.prompt-confirm-btn') as HTMLElement)?.click();
        break;
    }
  }

  /**
   * Desktop: right-click = cancel.
   *
   * Resolution order (P0-3bis.3 / Sprint cleanup 2026-05-08):
   *  1. If the active prompt has a local Cancel button (`.btn--secondary`,
   *     ex: SELECT_YESNO "No", SELECT_CARD "Cancel" when `cancelable=true`,
   *     SELECT_CHAIN "Don't chain" when `!forced`) → click it. This is
   *     the path ocgcore expects — the engine receives a normal "no
   *     selection" response and continues naturally.
   *
   *  2. Otherwise (SELECT_POSITION, SELECT_TRIBUTE forced, SELECT_CARD
   *     `cancelable=false`, etc. — prompts that have no client-side
   *     escape hatch) → fall back to the server-side rollback via
   *     `CANCEL_PROMPT_SEQUENCE`. The worker rewinds to the most recent
   *     IDLECMD/BATTLECMD snapshot and re-emits the original prompt.
   *
   * Replay (`readOnly`) and closed-dialog states are no-op.
   *
   * SELECT_PLACE / SELECT_DISFIELD are handled by `prompt-zone-highlight`,
   * not this dialog (they live on the board overlay).
   */
  @HostListener('document:contextmenu', ['$event'])
  handleContextMenu(event: MouseEvent): void {
    if (this.readOnly()) return;
    if (this.dialogState() !== 'open') return;
    event.preventDefault();

    const cancelBtn = this.elementRef.nativeElement.querySelector('.btn--secondary') as HTMLElement | null;
    if (cancelBtn) {
      cancelBtn.click();
      return;
    }

    // No local Cancel — this is a forced/non-cancelable prompt. Fall back
    // to the server-side rollback. The worker will re-emit the prior
    // IDLECMD/BATTLECMD prompt (or the rate-limit / phase-guard server
    // path will silently reject if not eligible).
    this.wsService.sendCancelPromptSequence();
    this.liveAnnouncer.announce(this.translate.instant('duel.a11y.selectionCancelled'), 'polite');
  }

  toggleCollapse(): void {
    const s = this.dialogState();
    if (s === 'open') {
      this.dialogState.set('collapsed');
    } else if (s === 'collapsed') {
      this.dialogState.set('open');
    }
  }

  ngAfterViewInit(): void {
    // Create & destroy one instance of each portal sub-component to force
    // Angular to register their scoped styles before first real use (prevents FOUC).
    const seen = new Set<Type<PromptSubComponent>>();
    for (const type of [...Object.values(PROMPT_COMPONENT_MAP), PromptActionListReadonlyComponent]) {
      if (seen.has(type)) continue;
      seen.add(type);
      createComponent(type, { environmentInjector: this.envInjector, elementInjector: this.injector }).destroy();
    }

    if (this.pendingAttach) {
      const { prompt, componentType } = this.pendingAttach;
      this.pendingAttach = null;
      this.attachComponent(prompt, componentType);
      this.dialogState.set('open');
    }
  }

  ngOnDestroy(): void {
    this.detachComponent();
    this.langChangeSubscription?.unsubscribe();
    this.langChangeSubscription = null;
  }

  // --- Private ---

  private onPromptChange(prompt: Prompt | null): void {
    if (!prompt || (IGNORED_PROMPT_TYPES.has(prompt.type) && !this.readOnly())) {
      // Keep dialog open during: RPS waiting, TP response sent, or passive message active
      if (this.wsService.diceInProgress() || this.wsService.firstPlayerResponseSent() || this.passiveMessage()) return;

      if (this.dialogState() !== 'closed') {
        this.closeDialog();
      }
      return;
    }

    // In readOnly mode, IDLECMD/BATTLECMD use a dedicated read-only renderer
    if (IGNORED_PROMPT_TYPES.has(prompt.type) && this.readOnly()) {
      this.openForPrompt(prompt, PromptActionListReadonlyComponent);
      return;
    }

    if (AUTO_SELECT_PROMPT_TYPES.has(prompt.type)) return;

    const componentType = PROMPT_COMPONENT_MAP[prompt.type];
    if (!componentType) {
      // Prompt handled elsewhere (e.g. zone highlights for SELECT_PLACE/SELECT_DISFIELD).
      // Close any open dialog so it doesn't block board interactions.
      if (this.dialogState() !== 'closed') this.closeDialog();
      return;
    }

    this.openForPrompt(prompt, componentType);
  }

  private openForPrompt(prompt: Prompt, componentType: Type<PromptSubComponent>): void {
    this.isSending.set(false);
    this.refreshHintText(prompt);

    if (this.portalOutlet) {
      this.swapComponent(prompt, componentType);
      this.dialogState.set('open');
    } else {
      // Defer visibility until ngAfterViewInit attaches the content
      this.pendingAttach = { prompt, componentType };
    }
  }

  /**
   * Builds the localized hint banner for `prompt` and commits it to
   * `hintText`. The hint `action` and the SELECT_CHAIN timing label are
   * resolved client-side from the raw `hintType` / `value` / `hintTiming`
   * codes (see `duel-hint.util.ts`) — keyed off the current UI language.
   * Re-run on a language change so an open prompt re-localizes in place.
   */
  private refreshHintText(prompt: Prompt): void {
    const hint = this.hintContext() ?? this.wsService.hintContext();
    const hasHint = hint.hintType !== 0;

    // For SELECT_CHAIN, only show "X is activated" if there's actually an active chain.
    // Otherwise the hint cardName is leftover from a summon/effect, not an activation.
    const chainHasActivation = prompt.type === 'SELECT_CHAIN' && this.wsService.activeChainLinks().length === 0;
    const hintCardName = hasHint && !chainHasActivation ? hint.cardName : '';
    // SELECT_EFFECTYN / SELECT_YESNO carry their own cardName — trust it over a leftover hint
    // from an unrelated prior event (e.g. the Link summon that triggered this prompt).
    const promptCardName = 'cardName' in prompt ? (prompt as { cardName: string }).cardName : '';
    const confirmedCards = (this.confirmedCards() ?? this.wsService.lastConfirmedCards).filter(isExcavatedCard);
    const lastConfirmedName = prompt.type === 'SELECT_OPTION' && confirmedCards.length > 0
      ? confirmedCards[confirmedCards.length - 1].name
      : '';
    const cardName = promptCardName || hintCardName || lastConfirmedName;
    this.duelLogger.log(DuelLogCategory.PIPELINE, `[PROMPT] type=${prompt.type} | hint=%o | hintCardName="${hintCardName}" | promptCardName="${promptCardName}" | lastConfirmedName="${lastConfirmedName}" | resolved="${cardName}"`, hint);
    // HINT_SELECTMSG (hintType 3) is meant for card-selection prompts.
    // Ignore its action for non-selection prompts (e.g. SELECT_OPTION) to prevent
    // a stale "Select the card(s) to destroy" from a previous targeting step bleeding in.
    const isCardSelectionPrompt = prompt.type === 'SELECT_CARD' || prompt.type === 'SELECT_CHAIN'
      || prompt.type === 'SELECT_TRIBUTE' || prompt.type === 'SELECT_SUM'
      || prompt.type === 'SELECT_UNSELECT_CARD' || prompt.type === 'SELECT_COUNTER';
    const hintAction = hasHint && (hint.hintType !== 3 || isCardSelectionPrompt)
      ? this.resolveHintAction(hint)
      : '';
    const hintTimingLabel = prompt.type === 'SELECT_CHAIN'
      ? resolveHintTimingLabel((prompt as { hintTiming: number }).hintTiming, this.hintDeps(hint))
      : '';
    // SELECT_EFFECTYN / SELECT_YESNO carry a numeric `description` reference
    // code — resolve it client-side (FR/EN) instead of reading server text.
    const descriptionText = this.resolveSystemDescription(prompt);
    this.hintText.set(this.buildHintText(prompt.type, cardName, hintAction, hintTimingLabel, descriptionText));
    void this.resolveDescriptionAsync(prompt, cardName, hintAction, hintTimingLabel);
  }

  /**
   * Resolves the hint action text from the raw `hintType` + `value`. An
   * unanticipated `hintType` yields '' (the util's default) — logged here
   * rather than rendering a raw number to the player.
   */
  private resolveHintAction(hint: HintContext): string {
    const action = resolveHintAction(hint.hintType, hint.value, this.hintDeps(hint));
    // Warn ONLY for a genuinely unknown hintType — a known card-code type
    // that yields '' (empty card name) is benign, not a missing handler.
    if (!action && !KNOWN_HINT_TYPES.has(hint.hintType)) {
      this.duelLogger.warn('[PROMPT] unresolved hint — hintType=%s value=%s', hint.hintType, hint.value);
    }
    return action;
  }

  /**
   * Builds the `duel-hint.util` dependency bundle. System strings resolve via
   * `DuelSystemStringsService`; race/attribute bitmasks via the shared
   * `card_race.*` / `card_attribute.*` i18n keys; card codes via the
   * server-stamped `cardName` carried on the same hint (still a card
   * identity, not a system string).
   */
  private hintDeps(hint: HintContext): HintResolveDeps {
    return {
      resolveSystemString: i => this.systemStrings.resolveSystemString(i),
      resolveCardName: () => hint.cardName,
      resolveRace: bitmask => {
        const key = getRaceName(bitmask);
        return key ? this.translate.instant(`card_race.${key}`) : '';
      },
      resolveAttribute: bitmask => {
        const key = getAttributeName(bitmask);
        return key ? this.translate.instant(`card_attribute.${key}`) : '';
      },
    };
  }

  private swapComponent(prompt: Prompt, componentType: Type<PromptSubComponent>): void {
    this.detachComponent();
    this.attachComponent(prompt, componentType);
  }

  private attachComponent(prompt: Prompt, componentType: Type<PromptSubComponent>): void {
    if (!this.portalOutlet) return;
    this.detachComponent();

    const portal = new ComponentPortal(componentType);
    const ref = this.portalOutlet.attach(portal);

    ref.instance.promptData = prompt;
    ref.instance.hintContext = this.hintContext() ?? this.wsService.hintContext();
    ref.instance.readOnly = this.readOnly();
    ref.instance.preSelectedResponse = this.preSelectedResponse();

    const instance = ref.instance;
    if ('excludedCards' in instance) {
      (instance as unknown as { excludedCards: unknown[] }).excludedCards = this.wsService.lastSelectedCards;
    }
    // M22 — Read reveals tagged with the current chain link's index.
    // Replay-mode override (`confirmedCards` input set): preserve flat
    // semantics — the replay adapter pre-aggregates the revealed cards.
    const overrideConfirmed = this.confirmedCards();
    const allConfirmed = overrideConfirmed
      ?? this.wsService.confirmedCardsForChainIndex(
        selectCurrentChainLinkIndex(this.wsService.activeChainLinks()),
      );
    if ('revealedCards' in instance) {
      (instance as unknown as { revealedCards: unknown[] }).revealedCards =
        selectExcavatedReveals(allConfirmed);
    }
    if ('confirmedCardKeys' in instance) {
      (instance as unknown as { confirmedCardKeys: Set<string> }).confirmedCardKeys =
        new Set(allConfirmed.map(c => `${c.location}-${c.player}-${c.sequence}`));
    }
    if ('ownPlayerIndex' in instance) {
      (instance as unknown as { ownPlayerIndex: number }).ownPlayerIndex = this.ownPlayerIndex();
    }

    this.responseSubscription = instance.response.subscribe((data: unknown) => {
      const override = this.responseOverride();
      if (override) {
        override(data);
      } else {
        this.wsService.sendResponse(prompt.type, data as ResponseData);
      }
      this.isSending.set(true);
    });

    const rawInstance = ref.instance as unknown as Record<string, unknown>;
    if ('longPressInspect' in rawInstance && rawInstance['longPressInspect']) {
      this.longPressSubscription = (rawInstance['longPressInspect'] as { subscribe: (fn: (e: { cardCode: number }) => void) => { unsubscribe(): void } })
        .subscribe((e: { cardCode: number }) => this.longPressInspect.emit(e));
    }
    if ('preTargetCards' in rawInstance && rawInstance['preTargetCards']) {
      this.preTargetSubscription = (rawInstance['preTargetCards'] as { subscribe: (fn: (cards: CardInfo[]) => void) => { unsubscribe(): void } })
        .subscribe((cards: CardInfo[]) => this.preTargetCards.emit(cards));
    }
  }

  private detachComponent(): void {
    this.responseSubscription?.unsubscribe();
    this.responseSubscription = null;
    this.longPressSubscription?.unsubscribe();
    this.longPressSubscription = null;
    this.preTargetSubscription?.unsubscribe();
    this.preTargetSubscription = null;
    this.preTargetCards.emit([]);
    if (this.portalOutlet?.hasAttached()) {
      this.portalOutlet.detach();
    }
  }

  private closeDialog(): void {
    if (this.dialogState() === 'closed') return;
    this.pendingAttach = null;
    this.detachComponent();
    this.hintText.set(null);
    this.isSending.set(false);
    this.dialogState.set('closed');
  }

  /**
   * Yu-Gi-Oh game mechanic keywords highlighted à la Master Duel, compiled
   * into a regex from the language-specific `duel.prompt.hint.keywords` list
   * (`|`-separated). Cached per language so the regex is built once.
   */
  private hintKeywordRe: { lang: string; re: RegExp } | null = null;

  private hintKeywordRegex(): RegExp {
    const lang = this.translate.currentLang;
    if (this.hintKeywordRe?.lang === lang) return this.hintKeywordRe.re;
    const list = this.translate.instant('duel.prompt.hint.keywords');
    // Sorted longest-first in the i18n source so multi-word terms match first.
    const keywords = (typeof list === 'string' ? list : '')
      .split('|')
      .filter(Boolean)
      .map(k => k.replace(/[-/]/g, '\\$&'));
    const re = new RegExp(`(${keywords.join('|')})`, 'gi');
    this.hintKeywordRe = { lang, re };
    return re;
  }

  /** Wraps Yu-Gi-Oh keywords in <span class="hint-action"> for gold highlighting. */
  private highlightKeywords(text: string): string {
    const keywords = this.translate.instant('duel.prompt.hint.keywords');
    if (typeof keywords !== 'string' || !keywords) return text;
    return text.replace(
      this.hintKeywordRegex(),
      match => `<span class="hint-action">${match}</span>`,
    );
  }

  /**
   * Resolves the SELECT_EFFECTYN / SELECT_YESNO description for the initial
   * (synchronous) hint build.
   *
   * The server now ships `descriptionText` — the code's effect text resolved
   * from its `strN` paragraph (cards.cdb), the only place that text exists.
   * It is preferred whenever present. The legacy fallback resolves a system
   * string synchronously; a card-text code returns '' here and is filled in
   * by `resolveDescriptionAsync`.
   */
  private resolveSystemDescription(prompt: Prompt): string {
    const serverText = this.promptDescriptionText(prompt);
    if (serverText !== undefined) return serverText;

    const code = this.descriptionCode(prompt);
    if (code == null) return '';
    const result = resolveDescription(code, {
      resolveSystemString: i => this.systemStrings.resolveSystemString(i),
    });
    return result.kind === 'system' ? result.text : '';
  }

  /** Server-resolved description text of a SELECT_EFFECTYN / SELECT_YESNO
   *  prompt, or undefined on a legacy payload that carries none. */
  private promptDescriptionText(prompt: Prompt): string | undefined {
    if (prompt.type === 'SELECT_EFFECTYN' || prompt.type === 'SELECT_YESNO') {
      return (prompt as { descriptionText?: string }).descriptionText;
    }
    return undefined;
  }

  /**
   * Resolves the prompt's `description` code once async data is available:
   * the FR/EN system-string table (in case the sync attempt raced its load)
   * for `cardCode == 0`, or the localized card name for `cardCode != 0`.
   * Rebuilds the hint text and guards against a stale resolve by re-checking
   * the active prompt before committing.
   */
  private async resolveDescriptionAsync(prompt: Prompt, cardName: string, hintAction: string, hintTimingLabel: string): Promise<void> {
    const code = this.descriptionCode(prompt);
    if (code == null) return;
    // Server already resolved it — the sync `resolveSystemDescription` used it,
    // nothing to fetch.
    if (this.promptDescriptionText(prompt) !== undefined) return;

    const deps = { resolveSystemString: (i: number) => this.systemStrings.resolveSystemString(i) };
    const result = resolveDescription(code, deps);
    let descriptionText: string;
    if (result.kind === 'card') {
      descriptionText = (await this.cardDataCache.getCardData(result.cardCode)).name ?? '';
    } else {
      // Re-resolve after the table load resolves, in case the sync attempt raced it.
      await this.systemStrings.preload();
      descriptionText = this.systemStrings.resolveSystemString(decodeDescription(code).strIndex);
    }

    if (this.prompt() !== prompt) return; // prompt changed mid-fetch — drop
    this.hintText.set(this.buildHintText(prompt.type, cardName, hintAction, hintTimingLabel, descriptionText));
  }

  /** Extracts the numeric `description` code from prompts that carry one. */
  private descriptionCode(prompt: Prompt): number | null {
    if (prompt.type === 'SELECT_EFFECTYN' || prompt.type === 'SELECT_YESNO') {
      return (prompt as { description: number }).description;
    }
    return null;
  }

  private buildHintText(promptType: string, cardName: string, hintAction: string, hintTimingLabel = '', descriptionText = ''): string | null {
    const q = cardName ? `<span class="hint-card-name">\u201C${cardName}\u201D</span>` : '';
    const act = hintAction ? this.highlightKeywords(hintAction) : '';
    const a = (verb: string) => `<span class="hint-action">${verb}</span>`;
    const t = (key: string, params?: Record<string, string>): string =>
      this.translate.instant(`duel.prompt.hint.${key}`, params);

    // hintAction contains full system strings from strings.conf
    // (e.g. "Select the card(s) to Tribute") -- use directly + append card context.
    const withCardContext = act
      ? (q ? t('actionForCard', { act, card: q }) : act)
      : null;

    switch (promptType) {
      case 'SELECT_CHAIN': {
        const tl = hintTimingLabel ? this.highlightKeywords(hintTimingLabel) : '';
        const chain = t('chain', { verb: a(t('chainKeyword')) });
        const activated = q ? t('chainActivated', { card: q, chain }) : chain;
        return tl ? t('timingPrefix', { timing: tl, rest: activated }) : activated;
      }
      case 'SELECT_EFFECTYN': {
        // The em-dash separator is part of the dynamic fragment so the
        // template stays clean when there is no description.
        const desc = descriptionText ? ` — ${descriptionText}` : '';
        return q
          ? t('activateEffectOf', { verb: a(t('activateVerb')), card: q, desc })
          : t('activateEffect', { verb: a(t('activateVerb')), desc });
      }
      case 'SELECT_CARD':
      case 'SELECT_TRIBUTE':
      case 'SELECT_SUM':
      case 'SELECT_UNSELECT_CARD':
        return withCardContext
          ?? (q ? t('selectCardsForCard', { verb: a(t('selectVerb')), card: q })
                : t('selectCards', { verb: a(t('selectVerb')) }));
      case 'SELECT_POSITION':
        return q
          ? t('choosePositionForCard', { verb: a(t('chooseVerb')), card: q })
          : t('choosePosition', { verb: a(t('chooseVerb')) });
      case 'SELECT_PLACE':
      case 'SELECT_DISFIELD':
        return t('chooseZone', { verb: a(t('chooseVerb')) });
      case 'SELECT_OPTION':
        return withCardContext
          ?? (q ? t('chooseOptionForCard', { verb: a(t('chooseVerb')), card: q })
                : t('chooseOption', { verb: a(t('chooseVerb')) }));
      case 'SELECT_COUNTER':
        return t('distributeCounters', { verb: a(t('distributeVerb')) });
      case 'ANNOUNCE_NUMBER':
        return q
          ? t('declareNumberForCard', { verb: a(t('declareVerb')), card: q })
          : t('declareNumber', { verb: a(t('declareVerb')) });
      case 'ANNOUNCE_CARD':
        return q
          ? t('declareCardNameForCard', { verb: a(t('declareVerb')), card: q })
          : t('declareCardName', { verb: a(t('declareVerb')) });
      case 'SORT_CARD':
      case 'SORT_CHAIN':
        return t('setCardOrder', { verb: a(t('setVerb')) });
      case 'SELECT_IDLECMD':
      case 'SELECT_BATTLECMD':
        return act ? t('itIsThePhase', { act }) : null;
      case 'SELECT_YESNO':
        return descriptionText ? (q ? t('cardWithDesc', { card: q, desc: descriptionText }) : descriptionText) : q || null;
      case 'SELECT_FIRST_PLAYER':
        return t('chooseFirstPlayer', { verb: a(t('chooseVerb')) });
      case 'DICE_ROLL':
        return t('rollDice', { verb: a(t('rollVerb')) });
      default:
        return q || null;
    }
  }
}
