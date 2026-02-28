import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
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

export type SheetState = 'closed' | 'opening' | 'open' | 'transitioning' | 'collapsed' | 'closing';

@Component({
  selector: 'app-pvp-prompt-sheet',
  templateUrl: './pvp-prompt-sheet.component.html',
  styleUrl: './pvp-prompt-sheet.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkPortalOutlet, CdkTrapFocus],
})
export class PvpPromptSheetComponent implements OnDestroy {
  private readonly wsService = inject(DuelWebSocketService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  @ViewChild(CdkPortalOutlet) portalOutlet!: CdkPortalOutlet;

  readonly sheetState = signal<SheetState>('closed');
  readonly hintText = signal<string | null>(null);
  readonly isBeat1 = signal(false);
  readonly isSending = signal(false);
  readonly currentHeight = signal<string>('auto');

  readonly isSheetVisible = computed(() => this.sheetState() !== 'closed');
  readonly trapFocusActive = computed(() => {
    const s = this.sheetState();
    return s === 'open' || s === 'opening' || s === 'transitioning';
  });

  // [H1 fix] Expose sheet expanded state for parent (mini-toolbar interaction)
  readonly sheetExpanded = output<boolean>();

  private beatTimeout: ReturnType<typeof setTimeout> | null = null;
  private closingTimeout: ReturnType<typeof setTimeout> | null = null;
  private responseSubscription: { unsubscribe(): void } | null = null;

  constructor() {
    effect(() => {
      const prompt = this.wsService.pendingPrompt();
      untracked(() => this.onPromptChange(prompt));
    });

    // [H1 fix] Emit sheet expanded state for mini-toolbar interaction
    effect(() => {
      const s = this.sheetState();
      const expanded = s === 'open' || s === 'opening' || s === 'transitioning';
      untracked(() => this.sheetExpanded.emit(expanded));
    });
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (this.sheetState() === 'closed') return;

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

  toggleCollapse(): void {
    const s = this.sheetState();
    if (s === 'open' || s === 'transitioning') {
      this.sheetState.set('collapsed');
    } else if (s === 'collapsed') {
      this.sheetState.set('open');
    }
  }

  ngOnDestroy(): void {
    this.clearTimeouts();
    this.detachComponent();
  }

  // --- Private ---

  private onPromptChange(prompt: Prompt | null): void {
    if (!prompt || IGNORED_PROMPT_TYPES.has(prompt.type)) {
      if (this.sheetState() !== 'closed') {
        const instant = this.wsService.duelResult() !== null;
        this.closeSheet(instant);
      }
      return;
    }

    if (AUTO_SELECT_PROMPT_TYPES.has(prompt.type)) return;

    const componentType = PROMPT_COMPONENT_MAP[prompt.type];
    if (!componentType) return;

    this.openForPrompt(prompt, componentType);
  }

  private openForPrompt(prompt: Prompt, componentType: Type<PromptSubComponent>): void {
    const hint = this.wsService.hintContext();
    const hasHint = hint.hintType !== 0;
    const wasOpen = this.sheetState() !== 'closed' && this.sheetState() !== 'closing';

    this.isSending.set(false);
    this.clearTimeouts();
    this.hintText.set(hasHint ? `Card: ${hint.value}` : null);

    if (wasOpen) {
      // Transitioning: swap content without close/reopen
      this.sheetState.set('transitioning');
      this.swapComponent(prompt, componentType);
      this.beatTimeout = setTimeout(() => {
        if (this.sheetState() === 'transitioning') this.sheetState.set('open');
      }, 200);
    } else {
      // Opening: two-beat rendering
      this.sheetState.set('opening');
      this.isBeat1.set(hasHint);
      this.beatTimeout = setTimeout(() => {
        this.attachComponent(prompt, componentType);
        this.isBeat1.set(false);
        this.sheetState.set('open');
      }, hasHint ? 50 : 0);
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

    const h = ref.instance.preferredHeight;
    this.currentHeight.set(
      h === 'compact' ? 'var(--pvp-prompt-sheet-compact)' :
      h === 'full' ? 'auto' :
      `${h}px`
    );

    this.responseSubscription = ref.instance.response.subscribe((data: unknown) => {
      this.wsService.sendResponse(prompt.type, data as ResponseData);
      this.isSending.set(true);
    });
  }

  private detachComponent(): void {
    this.responseSubscription?.unsubscribe();
    this.responseSubscription = null;
    if (this.portalOutlet?.hasAttached()) {
      this.portalOutlet.detach();
    }
  }

  private closeSheet(instant: boolean): void {
    if (this.sheetState() === 'closed') return;
    this.clearTimeouts();
    this.detachComponent();
    this.hintText.set(null);
    this.isSending.set(false);
    this.isBeat1.set(false);

    if (instant) {
      this.sheetState.set('closed');
    } else {
      this.sheetState.set('closing');
      this.closingTimeout = setTimeout(() => this.sheetState.set('closed'), 300);
    }
  }

  private clearTimeouts(): void {
    if (this.beatTimeout) { clearTimeout(this.beatTimeout); this.beatTimeout = null; }
    if (this.closingTimeout) { clearTimeout(this.closingTimeout); this.closingTimeout = null; }
  }
}
