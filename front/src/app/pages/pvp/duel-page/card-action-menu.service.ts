import { computed, DestroyRef, ElementRef, inject, Injectable, signal } from '@angular/core';
import type { Player, SelectCardMsg } from '../duel-ws.types';
import { type CardAction, groupMenuActions } from './idle-action-codes';
import { setupClickOutsideListener } from './click-outside.utils';

type ResponderPromptType = 'SELECT_IDLECMD' | 'SELECT_BATTLECMD';

interface MenuState {
  top: number;
  left: number;
  actions: CardAction[];
  promptType: ResponderPromptType;
}

/**
 * Encapsulates the card action menu shown above a hand or field card during
 * SELECT_IDLECMD / SELECT_BATTLECMD prompts:
 *  - menu open positioning + viewport clamping + click-outside teardown
 *  - effect sub-menu (grouped "Activate Effect" entries)
 *  - pile prompt synthesis (grouped pile-card actions emit a synthetic
 *    SELECT_CARD prompt routed through the existing prompt dialog)
 *  - keyboard navigation (Arrow / Escape / Tab)
 *
 * Component-scoped (lives with DuelPageComponent). The host component supplies
 * the "send response" callback so the service stays decoupled from the
 * concrete WebSocket transport.
 */
@Injectable()
export class CardActionMenuService {
  static readonly MENU_HEIGHT = 200;
  static readonly MENU_WIDTH_WITH_PADDING = 164;
  static readonly MENU_HEIGHT_WITH_PADDING = 204;

  private readonly destroyRef = inject(DestroyRef);

  readonly menuState = signal<MenuState | null>(null);
  readonly effectSubMenu = signal<CardAction[] | null>(null);
  readonly pilePrompt = signal<SelectCardMsg | null>(null);

  readonly menuDisplayActions = computed(() => {
    const menu = this.menuState();
    if (!menu) return [];
    return groupMenuActions(menu.actions);
  });

  private pileActions: CardAction[] = [];
  private pilePromptType: ResponderPromptType = 'SELECT_IDLECMD';
  private teardownMenuListener: () => void = () => undefined;

  /** Hook fired after the menu closes (e.g. clear hand row selection). */
  private onCloseHook: () => void = () => undefined;

  setOnClose(hook: () => void): void {
    this.onCloseHook = hook;
  }

  // Use visualViewport for mobile-safe bounds checking (handles on-screen keyboard).
  open(element: HTMLElement, actions: CardAction[], promptType: ResponderPromptType): void {
    const rect = element.getBoundingClientRect();
    const vpWidth = window.visualViewport?.width ?? window.innerWidth;
    const vpHeight = window.visualViewport?.height ?? window.innerHeight;
    const gap = 10;
    let left = rect.left;
    let top = rect.top - CardActionMenuService.MENU_HEIGHT - gap;
    left = Math.max(4, Math.min(left, vpWidth - CardActionMenuService.MENU_WIDTH_WITH_PADDING));
    if (top < 4) {
      top = rect.bottom + gap;
    }
    if (top + CardActionMenuService.MENU_HEIGHT > vpHeight) {
      top = Math.max(4, vpHeight - CardActionMenuService.MENU_HEIGHT_WITH_PADDING);
    }

    this.menuState.set({ top, left, actions, promptType });

    this.teardownMenuListener();
    // After the menu renders (next tick), attach click-outside listener
    setTimeout(() => {
      const menuEl = document.querySelector('.card-action-menu') as HTMLElement | null;
      if (menuEl) {
        const actualHeight = menuEl.offsetHeight;
        const actualWidth = menuEl.offsetWidth;
        const correctedTop = rect.top - actualHeight - gap;
        const centeredLeft = Math.max(4, Math.min(
          rect.left + rect.width / 2 - actualWidth / 2,
          vpWidth - actualWidth - 4,
        ));
        this.menuState.update(s => s ? {
          ...s,
          left: centeredLeft,
          top: correctedTop >= 4 ? correctedTop : s.top,
        } : s);
        this.teardownMenuListener = setupClickOutsideListener(
          { nativeElement: menuEl } as ElementRef,
          this.destroyRef,
          () => this.close(),
        );
      }
    });
  }

  close(): void {
    this.menuState.set(null);
    this.effectSubMenu.set(null);
    this.teardownMenuListener();
    this.onCloseHook();
  }

  /**
   * Handle a primary menu item click. Branches:
   *  - children with cardCode → synthesize a pile SELECT_CARD prompt
   *  - children without cardCode → open the effect sub-menu
   *  - leaf action → invoke `sendResponse(promptType, payload)` and close
   */
  onAction(
    action: CardAction,
    sendResponse: (promptType: ResponderPromptType, payload: { action: number; index: number | null }) => void,
    event?: MouseEvent,
  ): void {
    if (action.children) {
      if (action.children[0]?.cardCode) {
        const menu = this.menuState();
        if (!menu) return;
        this.pileActions = action.children;
        this.pilePromptType = menu.promptType;
        this.pilePrompt.set({
          type: 'SELECT_CARD',
          player: 0,
          min: 1,
          max: 1,
          cancelable: true,
          cards: action.children.map(c => ({
            cardCode: c.cardCode!,
            name: c.cardName ?? '',
            player: 0 as Player,
            location: 0 as never,
            sequence: 0,
            description: c.description,
          })),
        });
        this.close();
        return;
      }
      event?.stopPropagation();
      this.effectSubMenu.set(action.children);
      return;
    }
    const menu = this.menuState();
    if (!menu) return;
    sendResponse(menu.promptType, { action: action.actionCode, index: action.index });
    this.close();
  }

  onChildAction(
    action: CardAction,
    sendResponse: (promptType: ResponderPromptType, payload: { action: number; index: number | null }) => void,
  ): void {
    this.effectSubMenu.set(null);
    this.onAction(action, sendResponse);
  }

  onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        if (this.effectSubMenu()) {
          this.effectSubMenu.set(null);
        } else {
          this.close();
        }
        event.preventDefault();
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        const items = Array.from(
          (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]'),
        );
        const current = items.indexOf(event.target as HTMLElement);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = items[(current + delta + items.length) % items.length];
        next?.focus();
        event.preventDefault();
        break;
      }
      case 'Tab':
        event.preventDefault();
        break;
    }
  }

  /**
   * Pile prompt response handler. Wired into the SELECT_CARD prompt dialog
   * via `[responseOverride]`. Maps the chosen index back to the action and
   * fires `sendResponse(savedPromptType, payload)`.
   */
  pileResponse(
    data: unknown,
    sendResponse: (promptType: ResponderPromptType, payload: { action: number; index: number | null }) => void,
  ): void {
    const resp = data as { indices: number[] };
    const idx = resp.indices?.[0];
    const action = this.pileActions[idx];
    if (action) {
      sendResponse(this.pilePromptType, { action: action.actionCode, index: action.index });
    }
    this.pilePrompt.set(null);
    this.pileActions = [];
  }
}
