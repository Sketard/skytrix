import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  Type,
  untracked,
  ViewChild,
} from '@angular/core';
import { CdkPortalOutlet, ComponentPortal } from '@angular/cdk/portal';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { DuelWebSocketService, ResponseData } from '../../duel-web-socket.service';
import {
  AUTO_SELECT_PROMPT_TYPES,
  IGNORED_PROMPT_TYPES,
  PROMPT_COMPONENT_MAP,
  PromptSubComponent,
} from '../prompt.types';
import { Prompt } from '../../../types';

export type DialogState = 'closed' | 'opening' | 'open' | 'transitioning' | 'collapsed' | 'closing';

@Component({
  selector: 'app-pvp-prompt-dialog',
  templateUrl: './pvp-prompt-dialog.component.html',
  styleUrl: './pvp-prompt-dialog.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkPortalOutlet, CdkTrapFocus],
})
export class PvpPromptDialogComponent implements OnDestroy {
  private readonly wsService = inject(DuelWebSocketService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  @ViewChild(CdkPortalOutlet) portalOutlet!: CdkPortalOutlet;

  readonly prompt = input<Prompt | null>(null);
  readonly skipBeat1 = input(false);

  readonly dialogState = signal<DialogState>('closed');
  readonly hintText = signal<string | null>(null);
  readonly isBeat1 = signal(false);
  readonly isSending = signal(false);

  readonly isDialogVisible = computed(() => this.dialogState() !== 'closed');
  readonly trapFocusActive = computed(() => {
    const s = this.dialogState();
    return s === 'open' || s === 'opening' || s === 'transitioning';
  });

  readonly dialogExpanded = output<boolean>();
  readonly longPressInspect = output<{ cardCode: number }>();

  private beatTimeout: ReturnType<typeof setTimeout> | null = null;
  private closingTimeout: ReturnType<typeof setTimeout> | null = null;
  private responseSubscription: { unsubscribe(): void } | null = null;
  private longPressSubscription: { unsubscribe(): void } | null = null;

  constructor() {
    effect(() => {
      const prompt = this.prompt();
      untracked(() => this.onPromptChange(prompt));
    });

    effect(() => {
      const s = this.dialogState();
      const expanded = s === 'open' || s === 'opening' || s === 'transitioning';
      untracked(() => this.dialogExpanded.emit(expanded));
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

  // Desktop: right-click = cancel/no
  @HostListener('document:contextmenu', ['$event'])
  handleContextMenu(event: MouseEvent): void {
    const s = this.dialogState();
    if (s !== 'open' && s !== 'opening' && s !== 'transitioning') return;
    event.preventDefault();
    const cancelBtn = this.elementRef.nativeElement.querySelector('.btn--secondary') as HTMLElement;
    cancelBtn?.click();
  }

  toggleCollapse(): void {
    const s = this.dialogState();
    if (s === 'open' || s === 'transitioning') {
      this.dialogState.set('collapsed');
    } else if (s === 'collapsed') {
      this.dialogState.set('open');
    }
  }

  ngOnDestroy(): void {
    this.clearTimeouts();
    this.detachComponent();
  }

  // --- Private ---

  private onPromptChange(prompt: Prompt | null): void {
    console.log('[PROMPT-DIALOG] onPromptChange type=%s dialogState=%s', prompt?.type ?? 'null', this.dialogState());
    if (!prompt || IGNORED_PROMPT_TYPES.has(prompt.type)) {
      if (this.dialogState() !== 'closed') {
        const instant = this.wsService.duelResult() !== null;
        this.closeDialog(instant);
      }
      return;
    }

    if (AUTO_SELECT_PROMPT_TYPES.has(prompt.type)) return;

    const componentType = PROMPT_COMPONENT_MAP[prompt.type];
    if (!componentType) {
      // Prompt handled elsewhere (e.g. zone highlights for SELECT_PLACE/SELECT_DISFIELD).
      // Close any open dialog so it doesn't block board interactions.
      if (this.dialogState() !== 'closed') this.closeDialog(true);
      return;
    }

    this.openForPrompt(prompt, componentType);
  }

  private openForPrompt(prompt: Prompt, componentType: Type<PromptSubComponent>): void {
    const hint = this.wsService.hintContext();
    const hasHint = hint.hintType !== 0;
    const wasOpen = this.dialogState() !== 'closed' && this.dialogState() !== 'closing';

    this.isSending.set(false);
    this.clearTimeouts();
    // For SELECT_CHAIN, only show "X is activated" if there's actually an active chain.
    // Otherwise the hint cardName is leftover from a summon/effect, not an activation.
    const chainHasActivation = prompt.type === 'SELECT_CHAIN' && this.wsService.activeChainLinks().length === 0;
    const cardName = hasHint && !chainHasActivation ? hint.cardName : '';
    const hintAction = hasHint ? hint.hintAction : '';
    this.hintText.set(this.buildHintText(prompt.type, cardName, hintAction));

    if (wasOpen) {
      this.dialogState.set('transitioning');
      this.swapComponent(prompt, componentType);
      this.beatTimeout = setTimeout(() => {
        if (this.dialogState() === 'transitioning') this.dialogState.set('open');
      }, 200);
    } else {
      this.dialogState.set('opening');
      const skipHintDelay = this.skipBeat1();
      this.isBeat1.set(hasHint && !skipHintDelay);
      this.beatTimeout = setTimeout(() => {
        this.attachComponent(prompt, componentType);
        this.isBeat1.set(false);
        this.dialogState.set('open');
      }, (hasHint && !skipHintDelay) ? 50 : 0);
    }
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
    ref.instance.hintContext = this.wsService.hintContext();

    const instance = ref.instance;
    if ('excludedCards' in instance) {
      (instance as unknown as { excludedCards: unknown[] }).excludedCards = this.wsService.lastSelectedCards;
    }

    this.responseSubscription = instance.response.subscribe((data: unknown) => {
      this.wsService.sendResponse(prompt.type, data as ResponseData);
      this.isSending.set(true);
    });

    const rawInstance = ref.instance as unknown as Record<string, unknown>;
    if ('longPressInspect' in rawInstance && rawInstance['longPressInspect']) {
      this.longPressSubscription = (rawInstance['longPressInspect'] as { subscribe: (fn: (e: { cardCode: number }) => void) => { unsubscribe(): void } })
        .subscribe((e: { cardCode: number }) => this.longPressInspect.emit(e));
    }
  }

  private detachComponent(): void {
    this.responseSubscription?.unsubscribe();
    this.responseSubscription = null;
    this.longPressSubscription?.unsubscribe();
    this.longPressSubscription = null;
    if (this.portalOutlet?.hasAttached()) {
      this.portalOutlet.detach();
    }
  }

  private closeDialog(instant: boolean): void {
    if (this.dialogState() === 'closed') return;
    this.clearTimeouts();
    this.detachComponent();
    this.hintText.set(null);
    this.isSending.set(false);
    this.isBeat1.set(false);

    if (instant) {
      this.dialogState.set('closed');
    } else {
      this.dialogState.set('closing');
      this.closingTimeout = setTimeout(() => this.dialogState.set('closed'), 200);
    }
  }

  // Yu-Gi-Oh game mechanic keywords highlighted à la Master Duel.
  // Sorted longest-first so multi-word terms match before their substrings.
  private static readonly HINT_KEYWORDS = [
    'Tribute Summon', 'Normal Summon', 'Special Summon', 'Flip Summon',
    'Fusion Material', 'Synchro Material', 'Xyz Material', 'Link Material',
    'Pendulum Spell',
    'Attack Position', 'Defense Position',
    'Tribute', 'discard', 'destroy', 'banish', 'equip', 'detach',
    'activate', 'negate', 'target', 'reveal', 'Set',
    'send to the GY', 'return to the hand', 'return to the Deck',
    'return to the GY', 'add to your hand', 'place on the field',
    'attach as material', 'change control',
    'face-up', 'face-down',
    'Chain',
  ];

  private static readonly HINT_KEYWORD_RE = new RegExp(
    `(${PvpPromptDialogComponent.HINT_KEYWORDS.map(k => k.replace(/[-/]/g, '\\$&')).join('|')})`,
    'gi',
  );

  /** Wraps Yu-Gi-Oh keywords in <span class="hint-action"> for gold highlighting. */
  private highlightKeywords(text: string): string {
    return text.replace(
      PvpPromptDialogComponent.HINT_KEYWORD_RE,
      match => `<span class="hint-action">${match}</span>`,
    );
  }

  private buildHintText(promptType: string, cardName: string, hintAction: string): string | null {
    const q = cardName ? `<span class="hint-card-name">\u201C${cardName}\u201D</span>` : '';
    const act = hintAction ? this.highlightKeywords(hintAction) : '';
    const a = (verb: string) => `<span class="hint-action">${verb}</span>`;

    // hintAction contains full system strings from strings.conf
    // (e.g. "Select the card(s) to Tribute") — use directly + append card context
    const withCardContext = act ? (q ? `${act} for ${q}` : act) : null;

    switch (promptType) {
      case 'SELECT_CHAIN':
        return q
          ? `${q} is activated. ${a('Chain')} another card or effect?`
          : `${a('Chain')} another card or effect?`;
      case 'SELECT_EFFECTYN':
        return q
          ? `${a('Activate')} effect of ${q}?`
          : `${a('Activate')} effect?`;
      case 'SELECT_CARD':
      case 'SELECT_TRIBUTE':
      case 'SELECT_SUM':
      case 'SELECT_UNSELECT_CARD':
        return withCardContext ?? (q ? `${a('Select')} card(s) for ${q}` : `${a('Select')} card(s)`);
      case 'SELECT_POSITION':
        return q ? `${a('Choose')} position for ${q}` : `${a('Choose')} position`;
      case 'SELECT_PLACE':
      case 'SELECT_DISFIELD':
        return `${a('Choose')} a zone`;
      case 'SELECT_OPTION':
        return withCardContext ?? `${a('Choose')} an option`;
      case 'SELECT_COUNTER':
        return `${a('Distribute')} counters`;
      case 'ANNOUNCE_NUMBER':
        return q ? `${a('Declare')} a number for ${q}` : `${a('Declare')} a number`;
      case 'SORT_CARD':
      case 'SORT_CHAIN':
        return `${a('Set')} card order`;
      case 'SELECT_YESNO':
        return q || null;
      default:
        return q || null;
    }
  }

  private clearTimeouts(): void {
    if (this.beatTimeout) { clearTimeout(this.beatTimeout); this.beatTimeout = null; }
    if (this.closingTimeout) { clearTimeout(this.closingTimeout); this.closingTimeout = null; }
  }
}
