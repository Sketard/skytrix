import { TestBed } from '@angular/core/testing';
import { CardActionMenuService } from './card-action-menu.service';
import type { CardAction } from './idle-action-codes';

function leafAction(overrides: Partial<CardAction> = {}): CardAction {
  return { label: 'Summon', actionCode: 1, index: 0, ...overrides };
}

function pileGroupAction(): CardAction {
  return {
    label: 'Activate from GY',
    actionCode: 99,
    index: -1,
    children: [
      { label: 'Card A', actionCode: 99, index: 0, cardCode: 111, cardName: 'A' },
      { label: 'Card B', actionCode: 99, index: 1, cardCode: 222, cardName: 'B' },
    ],
  };
}

function effectGroupAction(): CardAction {
  return {
    label: 'Activate Effect',
    actionCode: 5,
    index: -1,
    children: [
      { label: 'Effect 1', actionCode: 5, index: 0 },
      { label: 'Effect 2', actionCode: 5, index: 1 },
    ],
  };
}

describe('CardActionMenuService', () => {
  let service: CardActionMenuService;
  let sendResponse: jasmine.Spy;
  let onCloseHook: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CardActionMenuService] });
    service = TestBed.inject(CardActionMenuService);
    sendResponse = jasmine.createSpy('sendResponse');
    onCloseHook = jasmine.createSpy('onCloseHook');
    service.setOnClose(onCloseHook);
  });

  describe('open', () => {
    it('sets menuState with positioning derived from element rect', () => {
      const el = document.createElement('div');
      // Stub bounding rect — jsdom returns zeros, force a realistic value
      spyOn(el, 'getBoundingClientRect').and.returnValue({
        top: 300, left: 100, right: 200, bottom: 400, width: 100, height: 100,
        x: 100, y: 300, toJSON: () => ({}),
      });
      service.open(el, [leafAction()], 'SELECT_IDLECMD');
      const state = service.menuState();
      expect(state).toBeTruthy();
      expect(state!.actions.length).toBe(1);
      expect(state!.promptType).toBe('SELECT_IDLECMD');
    });

    it('clamps top below viewport when card is near the top', () => {
      const el = document.createElement('div');
      spyOn(el, 'getBoundingClientRect').and.returnValue({
        top: 5, left: 100, right: 200, bottom: 105, width: 100, height: 100,
        x: 100, y: 5, toJSON: () => ({}),
      });
      service.open(el, [leafAction()], 'SELECT_IDLECMD');
      // Initial top would be 5 - 200 - 10 = -205 → clamped → fallback to bottom + gap = 115
      const state = service.menuState();
      expect(state!.top).toBeGreaterThanOrEqual(4);
    });
  });

  describe('close', () => {
    it('clears menuState, effectSubMenu and fires onCloseHook', () => {
      const el = document.createElement('div');
      spyOn(el, 'getBoundingClientRect').and.returnValue({
        top: 300, left: 100, right: 200, bottom: 400, width: 100, height: 100,
        x: 100, y: 300, toJSON: () => ({}),
      });
      service.open(el, [leafAction()], 'SELECT_IDLECMD');
      service.effectSubMenu.set([leafAction()]);
      service.close();
      expect(service.menuState()).toBeNull();
      expect(service.effectSubMenu()).toBeNull();
      expect(onCloseHook).toHaveBeenCalled();
    });
  });

  describe('onAction — leaf', () => {
    it('invokes sendResponse with promptType + payload and closes the menu', () => {
      const el = document.createElement('div');
      spyOn(el, 'getBoundingClientRect').and.returnValue({
        top: 300, left: 100, right: 200, bottom: 400, width: 100, height: 100,
        x: 100, y: 300, toJSON: () => ({}),
      });
      const action = leafAction({ actionCode: 7, index: 3 });
      service.open(el, [action], 'SELECT_BATTLECMD');
      service.onAction(action, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith('SELECT_BATTLECMD', { action: 7, index: 3 });
      expect(service.menuState()).toBeNull();
    });

    it('does nothing when no menu is open', () => {
      service.onAction(leafAction(), sendResponse);
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  describe('onAction — pile group (children with cardCode)', () => {
    it('synthesizes a pile SELECT_CARD prompt and closes the menu', () => {
      const el = document.createElement('div');
      spyOn(el, 'getBoundingClientRect').and.returnValue({
        top: 300, left: 100, right: 200, bottom: 400, width: 100, height: 100,
        x: 100, y: 300, toJSON: () => ({}),
      });
      const pile = pileGroupAction();
      service.open(el, [pile], 'SELECT_IDLECMD');
      service.onAction(pile, sendResponse);
      const prompt = service.pilePrompt();
      expect(prompt).toBeTruthy();
      expect(prompt!.type).toBe('SELECT_CARD');
      expect(prompt!.cards.length).toBe(2);
      expect(prompt!.cards[0].cardCode).toBe(111);
      expect(service.menuState()).toBeNull();
      // Synthesizing the pile prompt does NOT call sendResponse — it waits
      // for the user to pick a card via the SELECT_CARD dialog.
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  describe('onAction — effect sub-menu (children without cardCode)', () => {
    it('opens effectSubMenu and stops the click event propagation', () => {
      const el = document.createElement('div');
      spyOn(el, 'getBoundingClientRect').and.returnValue({
        top: 300, left: 100, right: 200, bottom: 400, width: 100, height: 100,
        x: 100, y: 300, toJSON: () => ({}),
      });
      const eff = effectGroupAction();
      service.open(el, [eff], 'SELECT_IDLECMD');
      const evt = jasmine.createSpyObj<MouseEvent>('MouseEvent', ['stopPropagation']);
      service.onAction(eff, sendResponse, evt);
      expect(service.effectSubMenu()).toBe(eff.children!);
      expect(evt.stopPropagation).toHaveBeenCalled();
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  describe('onChildAction', () => {
    it('clears effectSubMenu and dispatches the child as a leaf', () => {
      const el = document.createElement('div');
      spyOn(el, 'getBoundingClientRect').and.returnValue({
        top: 300, left: 100, right: 200, bottom: 400, width: 100, height: 100,
        x: 100, y: 300, toJSON: () => ({}),
      });
      const eff = effectGroupAction();
      service.open(el, [eff], 'SELECT_IDLECMD');
      service.effectSubMenu.set(eff.children!);

      const child = eff.children![1];
      service.onChildAction(child, sendResponse);
      expect(service.effectSubMenu()).toBeNull();
      expect(sendResponse).toHaveBeenCalledWith('SELECT_IDLECMD', { action: 5, index: 1 });
    });
  });

  describe('onKeydown', () => {
    it('Escape closes the menu when no sub-menu is open', () => {
      const el = document.createElement('div');
      spyOn(el, 'getBoundingClientRect').and.returnValue({
        top: 300, left: 100, right: 200, bottom: 400, width: 100, height: 100,
        x: 100, y: 300, toJSON: () => ({}),
      });
      service.open(el, [leafAction()], 'SELECT_IDLECMD');
      const evt = new KeyboardEvent('keydown', { key: 'Escape' });
      spyOn(evt, 'preventDefault');
      service.onKeydown(evt);
      expect(service.menuState()).toBeNull();
      expect(evt.preventDefault).toHaveBeenCalled();
    });

    it('Escape closes only the sub-menu when one is open (preserves parent menu)', () => {
      const el = document.createElement('div');
      spyOn(el, 'getBoundingClientRect').and.returnValue({
        top: 300, left: 100, right: 200, bottom: 400, width: 100, height: 100,
        x: 100, y: 300, toJSON: () => ({}),
      });
      service.open(el, [leafAction()], 'SELECT_IDLECMD');
      service.effectSubMenu.set([leafAction()]);
      const evt = new KeyboardEvent('keydown', { key: 'Escape' });
      service.onKeydown(evt);
      expect(service.effectSubMenu()).toBeNull();
      expect(service.menuState()).not.toBeNull();
    });

    it('Tab is consumed (preventDefault) without state change', () => {
      const evt = new KeyboardEvent('keydown', { key: 'Tab' });
      spyOn(evt, 'preventDefault');
      service.onKeydown(evt);
      expect(evt.preventDefault).toHaveBeenCalled();
    });
  });

  describe('pileResponse', () => {
    it('forwards the chosen action via sendResponse and clears pilePrompt', () => {
      const el = document.createElement('div');
      spyOn(el, 'getBoundingClientRect').and.returnValue({
        top: 300, left: 100, right: 200, bottom: 400, width: 100, height: 100,
        x: 100, y: 300, toJSON: () => ({}),
      });
      const pile = pileGroupAction();
      service.open(el, [pile], 'SELECT_IDLECMD');
      service.onAction(pile, sendResponse);
      // user picked card index 1 in the pile dialog
      service.pileResponse({ indices: [1] }, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith('SELECT_IDLECMD', { action: 99, index: 1 });
      expect(service.pilePrompt()).toBeNull();
    });

    it('clears pilePrompt even when the chosen index is out of range', () => {
      service.pileResponse({ indices: [99] }, sendResponse);
      expect(sendResponse).not.toHaveBeenCalled();
      expect(service.pilePrompt()).toBeNull();
    });
  });
});
