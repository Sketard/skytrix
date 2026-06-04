/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: signals declared in this file are TestBed stubs (mocks of the
   real pipeline shape). They are not pipeline signals at runtime;
   the §3.2 tagging convention (transport / environment / projection)
   targets the real classes only. (α.7b.1, 2026-05-25) */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy, Component, EventEmitter, signal, WritableSignal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  PvpPromptDialogComponent,
  selectCurrentChainLinkIndex,
  selectExcavatedReveals,
  PassiveMessage,
} from './pvp-prompt-dialog.component';
import { DuelWebSocketService } from '../../duel-web-socket.service';
import { DuelSystemStringsService } from '../../../duel-system-strings.service';
import { CardDataCacheService } from '../../card-data-cache.service';
import { DuelLogger } from '../../duel-logger';
import { PROMPT_COMPONENT_MAP, PromptSubComponent } from '../prompt.types';
import { Prompt } from '../../../types';
import { CardInfo, LOCATION } from '../../../duel-ws.types';

// =============================================================================
// Pure-helper specs (kept from initial coverage — pin M22 chain-link selection
// + Aqua Dolphin hand-reveal isolation).
// =============================================================================

function link(chainIndex: number, resolving = false): { chainIndex: number; resolving: boolean } {
  return { chainIndex, resolving };
}

function card(location: number, sequence = 0, cardCode = 1234, name = 'Card'): CardInfo {
  return { cardCode, name, player: 0, location, sequence } as CardInfo;
}

describe('selectCurrentChainLinkIndex', () => {
  it('returns null when there is no active chain', () => {
    expect(selectCurrentChainLinkIndex([])).toBeNull();
  });

  it('returns the chainIndex of the only link in build phase', () => {
    expect(selectCurrentChainLinkIndex([link(0)])).toBe(0);
  });

  it('returns the LAST link during build phase (multiple links pending)', () => {
    expect(selectCurrentChainLinkIndex([link(0), link(1), link(2)])).toBe(2);
  });

  it('returns the link with resolving=true when one is resolving', () => {
    expect(selectCurrentChainLinkIndex([link(0), link(1), link(2, true)])).toBe(2);
  });

  it('prefers a resolving link over the last link (M22 mid-chain bug)', () => {
    expect(selectCurrentChainLinkIndex([link(0), link(1, true), link(2)])).toBe(1);
  });

  it('returns the first resolving link if multiple are flagged (defensive)', () => {
    expect(selectCurrentChainLinkIndex([link(0, true), link(1, true)])).toBe(0);
  });
});

describe('selectExcavatedReveals', () => {
  it('returns an empty array for an empty input', () => {
    expect(selectExcavatedReveals([])).toEqual([]);
  });

  it('keeps DECK location cards (excavate from main deck)', () => {
    const cards = [
      card(LOCATION.DECK, 0, 18795635, 'GMX Applied Experiment #55'),
      card(LOCATION.DECK, 1, 11111111, 'Some Dinosaur'),
    ];
    const out = selectExcavatedReveals(cards);
    expect(out.length).toBe(2);
    expect(out[0].cardCode).toBe(18795635);
  });

  it('keeps EXTRA location cards (extra-deck reveals e.g. Kewl Tune)', () => {
    const cards = [card(LOCATION.EXTRA, 0, 22222222, 'Some Synchro')];
    expect(selectExcavatedReveals(cards).length).toBe(1);
  });

  it('filters out HAND location cards (Aqua Dolphin reveal must not leak)', () => {
    const cards = [
      card(LOCATION.HAND, 0, 33333333, 'Polymerization'),
      card(LOCATION.HAND, 1, 44444444, 'Some Monster'),
    ];
    expect(selectExcavatedReveals(cards)).toEqual([]);
  });

  it('mixed input: keeps only excavate cards, drops hand reveals', () => {
    const cards = [
      card(LOCATION.HAND, 0, 33333333, 'Polymerization'),
      card(LOCATION.DECK, 0, 18795635, 'GMX Applied Experiment #55'),
      card(LOCATION.HAND, 1, 44444444, 'Some Monster'),
      card(LOCATION.EXTRA, 0, 22222222, 'Some Fusion'),
    ];
    const out = selectExcavatedReveals(cards);
    expect(out.length).toBe(2);
    expect(out.map(c => c.cardCode).sort()).toEqual([22222222, 18795635].sort());
  });

  it('does not mutate the input array', () => {
    const cards = [card(LOCATION.HAND, 0), card(LOCATION.DECK, 0)];
    const before = cards.slice();
    selectExcavatedReveals(cards);
    expect(cards).toEqual(before);
  });
});

// =============================================================================
// Component lifecycle specs (C2.1+2). Real PvpPromptDialogComponent + stub
// sub-components registered into PROMPT_COMPONENT_MAP for the test (avoids
// pulling DuelCardArtService and the full art-resolution graph). Pinning
// the dispatch contract (SELECT_X → mount the X-mapped component) is what
// the dialog itself does — the sub-components have their own specs.
// =============================================================================

@Component({ selector: 'app-stub-yesno', standalone: true, template: '<div class="stub-yesno"></div>', changeDetection: ChangeDetectionStrategy.OnPush })
class StubYesNoComponent implements PromptSubComponent {
  promptData: Prompt | null = null;
  hintContext = null;
  response = new EventEmitter<unknown>();
  readOnly = false;
  preSelectedResponse: unknown = undefined;
}

@Component({ selector: 'app-stub-option', standalone: true, template: '<div class="stub-option"></div>', changeDetection: ChangeDetectionStrategy.OnPush })
class StubOptionComponent implements PromptSubComponent {
  promptData: Prompt | null = null;
  hintContext = null;
  response = new EventEmitter<unknown>();
  readOnly = false;
  preSelectedResponse: unknown = undefined;
}

interface WsStub {
  hintContext: WritableSignal<{ hintType: number; player: number; value: number; cardName: string }>;
  activeChainLinks: WritableSignal<Array<{ chainIndex: number; resolving: boolean; negated: boolean; cardCode: number; cardName: string; player: number; zoneId: string; location: number; sequence: number }>>;
  diceInProgress: WritableSignal<boolean>;
  firstPlayerResponseSent: WritableSignal<boolean>;
  lastConfirmedCards: CardInfo[];
  lastSelectedCards: CardInfo[];
  confirmedCardsForChainIndex: jasmine.Spy;
  sendResponse: jasmine.Spy;
  sendCancelPromptSequence: jasmine.Spy;
}

/** Stub providers for the client-side description-resolution services.
 *  Includes DuelLogger (real, dependency-light) which the dialog injects since
 *  F1 routed its prompt-derivation logs through it. */
function descriptionServiceStubs() {
  return [
    DuelLogger,
    { provide: DuelSystemStringsService, useValue: {
      preload: () => Promise.resolve(),
      resolveSystemString: () => '',
      resolveWinReason: () => '',
    } },
    { provide: CardDataCacheService, useValue: {
      getCardData: () => Promise.resolve({ name: '' }),
    } },
  ];
}

function makeWsStub(): WsStub {
  return {
    hintContext: signal({ hintType: 0, player: 0, value: 0, cardName: '' }),
    activeChainLinks: signal([] as WsStub['activeChainLinks'] extends WritableSignal<infer T> ? T : never),
    diceInProgress: signal(false),
    firstPlayerResponseSent: signal(false),
    lastConfirmedCards: [] as CardInfo[],
    lastSelectedCards: [] as CardInfo[],
    confirmedCardsForChainIndex: jasmine.createSpy('confirmedCardsForChainIndex').and.returnValue([] as CardInfo[]),
    sendResponse: jasmine.createSpy('sendResponse'),
    sendCancelPromptSequence: jasmine.createSpy('sendCancelPromptSequence'),
  };
}

function makeYesNoPrompt(): Prompt {
  // `description` is the raw 64-bit OCGCore code (cardCode 0 → strIndex 30) —
  // the client resolves it to localized text via DuelSystemStringsService.
  return {
    type: 'SELECT_YESNO',
    player: 0,
    description: 30,
  } as unknown as Prompt;
}

function makeOptionPrompt(): Prompt {
  // `options` is an array of raw 64-bit description codes (cardCode 0 here).
  return {
    type: 'SELECT_OPTION',
    player: 0,
    options: [10, 11],
  } as unknown as Prompt;
}

function makeIdleCmdPrompt(): Prompt {
  return {
    type: 'SELECT_IDLECMD',
    player: 0,
    cmds: [],
  } as unknown as Prompt;
}

function makePlacePrompt(): Prompt {
  return {
    type: 'SELECT_PLACE',
    player: 0,
    count: 1,
    flag: 0,
  } as unknown as Prompt;
}

describe('PvpPromptDialogComponent — lifecycle (C2.1+2)', () => {
  let ws: WsStub;
  let fixture: ComponentFixture<PvpPromptDialogComponent>;
  let component: PvpPromptDialogComponent;
  let originalMap: Record<string, unknown>;

  beforeEach(() => {
    // Replace the registry with stub components so the test does not pull
    // DuelCardArtService et al. via the ngAfterViewInit pre-warm pass. The
    // contract under test is "dialog reads PROMPT_COMPONENT_MAP[type] and
    // mounts whatever it finds" — the values are plain Type tokens.
    originalMap = { ...PROMPT_COMPONENT_MAP };
    for (const k of Object.keys(PROMPT_COMPONENT_MAP)) delete PROMPT_COMPONENT_MAP[k];
    PROMPT_COMPONENT_MAP['SELECT_YESNO'] = StubYesNoComponent;
    PROMPT_COMPONENT_MAP['SELECT_OPTION'] = StubOptionComponent;
    // Note: SELECT_PLACE intentionally NOT registered — pins the "no map
    // entry → dialog closes" branch.

    ws = makeWsStub();

    TestBed.configureTestingModule({
      imports: [PvpPromptDialogComponent],
      providers: [
        { provide: DuelWebSocketService, useValue: ws },
        { provide: TranslateService, useValue: {
          instant: (k: string) => k,
          get: (k: string) => ({ subscribe: (fn: (v: string) => void) => fn(k) }),
          onLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onTranslationChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onDefaultLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
        } },
        { provide: LiveAnnouncer, useValue: { announce: jasmine.createSpy('announce') } },
        ...descriptionServiceStubs(),
      ],
    });

    fixture = TestBed.createComponent(PvpPromptDialogComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    for (const k of Object.keys(PROMPT_COMPONENT_MAP)) delete PROMPT_COMPONENT_MAP[k];
    Object.assign(PROMPT_COMPONENT_MAP, originalMap);
  });

  it('starts in dialogState="closed" with no prompt and no passive message', () => {
    fixture.detectChanges();
    expect(component.dialogState()).toBe('closed');
    expect(component.isDialogVisible()).toBe(false);
  });

  it('opens dialog when prompt is set (SELECT_YESNO)', () => {
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
    expect(component.dialogState()).toBe('open');
    expect(component.isDialogVisible()).toBe(true);
  });

  it('closes dialog when prompt is cleared (no passive, no rps, no tp)', () => {
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
    expect(component.dialogState()).toBe('open');

    fixture.componentRef.setInput('prompt', null);
    fixture.detectChanges();
    expect(component.dialogState()).toBe('closed');
  });

  it('opens dialog with passive message (no prompt)', () => {
    const msg: PassiveMessage = { title: 'Waiting opponent…', style: 'waiting' };
    fixture.componentRef.setInput('passiveMessage', msg);
    fixture.detectChanges();
    expect(component.dialogState()).toBe('open');
  });

  it('does not auto-close while diceInProgress is true', () => {
    // Open via passive message during RPS.
    ws.diceInProgress.set(true);
    fixture.componentRef.setInput('passiveMessage', { title: 'RPS', style: 'waiting' } as PassiveMessage);
    fixture.detectChanges();
    expect(component.dialogState()).toBe('open');

    // Clearing passive while RPS still in progress must NOT close — the rps
    // gate keeps the dialog up so the choice UI doesn't flicker away.
    fixture.componentRef.setInput('passiveMessage', null);
    fixture.detectChanges();
    expect(component.dialogState()).toBe('open');
  });

  it('emits dialogExpanded reflecting the latest dialogState', () => {
    const events: boolean[] = [];
    component.dialogExpanded.subscribe(v => events.push(v));

    fixture.detectChanges();
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
    fixture.componentRef.setInput('prompt', null);
    fixture.detectChanges();

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]).toBe(false);
  });

  it('mounts the SELECT_YESNO-mapped sub-component into the portal outlet', () => {
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();

    expect(component.portalOutlet.hasAttached()).toBe(true);
    const ref = component.portalOutlet.attachedRef as { instance: unknown };
    expect(ref.instance).toBeInstanceOf(StubYesNoComponent);
  });

  it('swaps the sub-component when prompt.type changes (YESNO → OPTION)', () => {
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
    const firstRef = component.portalOutlet.attachedRef as { instance: unknown };
    expect(firstRef.instance).toBeInstanceOf(StubYesNoComponent);

    fixture.componentRef.setInput('prompt', makeOptionPrompt());
    fixture.detectChanges();
    const secondRef = component.portalOutlet.attachedRef as { instance: unknown };
    expect(secondRef.instance).toBeInstanceOf(StubOptionComponent);
    expect(secondRef.instance).not.toBe(firstRef.instance);
  });

  it('IGNORED_PROMPT_TYPES (SELECT_IDLECMD) does NOT mount when not readOnly', () => {
    fixture.componentRef.setInput('prompt', makeIdleCmdPrompt());
    fixture.detectChanges();
    expect(component.dialogState()).toBe('closed');
    expect(component.portalOutlet.hasAttached()).toBe(false);
  });

  it('closes dialog when prompt has no PROMPT_COMPONENT_MAP entry (SELECT_PLACE → zone-highlight)', () => {
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
    expect(component.dialogState()).toBe('open');

    // SELECT_PLACE is not registered in our test map → dialog must close so
    // it doesn't block board interactions while zone-highlight handles it.
    fixture.componentRef.setInput('prompt', makePlacePrompt());
    fixture.detectChanges();
    expect(component.dialogState()).toBe('closed');
    expect(component.portalOutlet.hasAttached()).toBe(false);
  });

  it('detaches portal on ngOnDestroy', () => {
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
    expect(component.portalOutlet.hasAttached()).toBe(true);

    fixture.destroy();
    expect(component.portalOutlet.hasAttached()).toBe(false);
  });
});

// =============================================================================
// Response dispatch specs (C2.2). Sub-component emits `response` —
// dialog routes it to either the responseOverride input (replay mode) or
// wsService.sendResponse() (live PvP). Pin the override-vs-default branch,
// the isSending flag (anti-double-submit guard), and the longPressInspect
// re-emission.
// =============================================================================

@Component({ selector: 'app-stub-yesno-with-outputs', standalone: true, template: '<div></div>', changeDetection: ChangeDetectionStrategy.OnPush })
class StubYesNoWithOutputsComponent implements PromptSubComponent {
  promptData: Prompt | null = null;
  hintContext = null;
  response = new EventEmitter<unknown>();
  longPressInspect = new EventEmitter<{ cardCode: number }>();
  preTargetCards = new EventEmitter<CardInfo[]>();
  readOnly = false;
  preSelectedResponse: unknown = undefined;
}

describe('PvpPromptDialogComponent — response dispatch (C2.2)', () => {
  let ws: WsStub;
  let fixture: ComponentFixture<PvpPromptDialogComponent>;
  let component: PvpPromptDialogComponent;
  let originalMap: Record<string, unknown>;

  beforeEach(() => {
    originalMap = { ...PROMPT_COMPONENT_MAP };
    for (const k of Object.keys(PROMPT_COMPONENT_MAP)) delete PROMPT_COMPONENT_MAP[k];
    PROMPT_COMPONENT_MAP['SELECT_YESNO'] = StubYesNoWithOutputsComponent;

    ws = makeWsStub();

    TestBed.configureTestingModule({
      imports: [PvpPromptDialogComponent],
      providers: [
        { provide: DuelWebSocketService, useValue: ws },
        { provide: TranslateService, useValue: {
          instant: (k: string) => k,
          get: (k: string) => ({ subscribe: (fn: (v: string) => void) => fn(k) }),
          onLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onTranslationChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onDefaultLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
        } },
        { provide: LiveAnnouncer, useValue: { announce: jasmine.createSpy('announce') } },
        ...descriptionServiceStubs(),
      ],
    });

    fixture = TestBed.createComponent(PvpPromptDialogComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    for (const k of Object.keys(PROMPT_COMPONENT_MAP)) delete PROMPT_COMPONENT_MAP[k];
    Object.assign(PROMPT_COMPONENT_MAP, originalMap);
  });

  function mountAndGetSubComponent(): StubYesNoWithOutputsComponent {
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
    const ref = component.portalOutlet.attachedRef as { instance: StubYesNoWithOutputsComponent };
    return ref.instance;
  }

  it('routes response to wsService.sendResponse when no override is provided', () => {
    const sub = mountAndGetSubComponent();
    const payload = { yes: true };

    sub.response.emit(payload);

    expect(ws.sendResponse).toHaveBeenCalledTimes(1);
    expect(ws.sendResponse).toHaveBeenCalledWith('SELECT_YESNO', payload);
  });

  it('routes response to responseOverride when input is set; wsService.sendResponse is NOT called', () => {
    const override = jasmine.createSpy('responseOverride');
    fixture.componentRef.setInput('responseOverride', override);
    const sub = mountAndGetSubComponent();
    const payload = { yes: false };

    sub.response.emit(payload);

    expect(override).toHaveBeenCalledTimes(1);
    expect(override).toHaveBeenCalledWith(payload);
    expect(ws.sendResponse).not.toHaveBeenCalled();
  });

  it('sets isSending=true after a response is emitted (anti-double-submit guard)', () => {
    const sub = mountAndGetSubComponent();
    expect(component.isSending()).toBe(false);

    sub.response.emit({ yes: true });

    expect(component.isSending()).toBe(true);
  });

  it('re-emits longPressInspect events from the sub-component as the dialog output', () => {
    const sub = mountAndGetSubComponent();
    const events: Array<{ cardCode: number }> = [];
    component.longPressInspect.subscribe(e => events.push(e));

    sub.longPressInspect.emit({ cardCode: 12345 });

    expect(events).toEqual([{ cardCode: 12345 }]);
  });

  // F-bugB2 (2026-05-31) — `_answeredPrompt` identity guard. The sub-component
  // can emit its `response` more than once for the SAME prompt object: a
  // re-arm flow (re-creating the sub-component while the prompt object is
  // unchanged) installs a fresh `response` subscription that the user can
  // trigger again. Without the guard, a 2nd emit re-calls `sendResponse` →
  // the server sees a duplicate PLAYER_RESPONSE, drops it as `Unexpected`
  // (`awaitingResponse[player]` already cleared by the 1st response) → the
  // modal sticks on "Sending…" until the server timeout.
  //
  // Pin: a 2nd `response.emit` against the SAME prompt object is dropped
  // silently. The `isSending` flag stays `true` from the 1st emit.
  it('drops a 2nd response.emit for the SAME prompt object (F-bugB2)', () => {
    const sub = mountAndGetSubComponent();
    sub.response.emit({ index: null });
    expect(ws.sendResponse).toHaveBeenCalledTimes(1);

    // 2nd emit on the same subscription (same prompt object) — guard active.
    sub.response.emit({ index: null });
    expect(ws.sendResponse).toHaveBeenCalledTimes(1);
  });

  it('releases the guard when the prompt OBJECT changes (next server prompt, F-bugB2)', () => {
    const sub1 = mountAndGetSubComponent();
    sub1.response.emit({ index: null });
    expect(ws.sendResponse).toHaveBeenCalledTimes(1);

    // A NEW server prompt = different object. The dialog swaps the
    // sub-component; the guard must release so the user can answer the
    // new prompt.
    fixture.componentRef.setInput('prompt', { ...makeYesNoPrompt() });
    fixture.detectChanges();
    const ref = component.portalOutlet.attachedRef as { instance: StubYesNoWithOutputsComponent };
    const sub2 = ref.instance;
    expect(sub2).not.toBe(sub1);

    sub2.response.emit({ yes: true });
    expect(ws.sendResponse).toHaveBeenCalledTimes(2);
    expect(ws.sendResponse.calls.argsFor(1)).toEqual(['SELECT_YESNO', { yes: true }]);
  });
});

// =============================================================================
// HostListener + readOnly specs (C2.3). Pin the keyboard shortcuts (`c`
// toggle, ` ` confirm), the right-click cancel resolution order
// (local `.btn--secondary` first, fallback `sendCancelPromptSequence`),
// and the readOnly mode (contextmenu no-op + IDLECMD readonly path).
// =============================================================================

describe('PvpPromptDialogComponent — HostListeners + readOnly (C2.3)', () => {
  let ws: WsStub;
  let announcer: { announce: jasmine.Spy };
  let fixture: ComponentFixture<PvpPromptDialogComponent>;
  let component: PvpPromptDialogComponent;
  let originalMap: Record<string, unknown>;

  beforeEach(() => {
    originalMap = { ...PROMPT_COMPONENT_MAP };
    for (const k of Object.keys(PROMPT_COMPONENT_MAP)) delete PROMPT_COMPONENT_MAP[k];
    PROMPT_COMPONENT_MAP['SELECT_YESNO'] = StubYesNoComponent;

    ws = makeWsStub();
    announcer = { announce: jasmine.createSpy('announce') };

    TestBed.configureTestingModule({
      imports: [PvpPromptDialogComponent],
      providers: [
        { provide: DuelWebSocketService, useValue: ws },
        { provide: TranslateService, useValue: {
          instant: (k: string) => k,
          get: (k: string) => ({ subscribe: (fn: (v: string) => void) => fn(k) }),
          onLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onTranslationChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onDefaultLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
        } },
        { provide: LiveAnnouncer, useValue: announcer },
        ...descriptionServiceStubs(),
      ],
    });

    fixture = TestBed.createComponent(PvpPromptDialogComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    for (const k of Object.keys(PROMPT_COMPONENT_MAP)) delete PROMPT_COMPONENT_MAP[k];
    Object.assign(PROMPT_COMPONENT_MAP, originalMap);
  });

  function openDialog(): void {
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
  }

  it('keydown "c" toggles dialogState open <-> collapsed', () => {
    openDialog();
    expect(component.dialogState()).toBe('open');

    component.handleKeydown({ key: 'c', target: document.body, preventDefault: () => undefined } as unknown as KeyboardEvent);
    expect(component.dialogState()).toBe('collapsed');

    component.handleKeydown({ key: 'c', target: document.body, preventDefault: () => undefined } as unknown as KeyboardEvent);
    expect(component.dialogState()).toBe('open');
  });

  it('keydown is ignored when target is INPUT/TEXTAREA (typing in numeric input)', () => {
    openDialog();
    expect(component.dialogState()).toBe('open');

    const input = document.createElement('input');
    component.handleKeydown({ key: 'c', target: input, preventDefault: () => undefined } as unknown as KeyboardEvent);
    expect(component.dialogState()).toBe('open');
  });

  it('keydown is no-op when dialogState is closed', () => {
    expect(component.dialogState()).toBe('closed');
    const prevent = jasmine.createSpy('preventDefault');
    component.handleKeydown({ key: 'c', target: document.body, preventDefault: prevent } as unknown as KeyboardEvent);
    expect(component.dialogState()).toBe('closed');
    expect(prevent).not.toHaveBeenCalled();
  });

  it('contextmenu clicks the local .btn--secondary if present (no server cancel)', () => {
    openDialog();

    // Inject a Cancel button into the dialog DOM — same heuristic the dialog
    // applies (querySelector('.btn--secondary') from elementRef.nativeElement).
    const host = fixture.nativeElement as HTMLElement;
    const btn = document.createElement('button');
    btn.className = 'btn--secondary';
    const localClick = jasmine.createSpy('localClick');
    btn.addEventListener('click', localClick);
    host.appendChild(btn);

    const prevent = jasmine.createSpy('preventDefault');
    component.handleContextMenu({ preventDefault: prevent } as unknown as MouseEvent);

    expect(prevent).toHaveBeenCalled();
    expect(localClick).toHaveBeenCalled();
    expect(ws.sendCancelPromptSequence).not.toHaveBeenCalled();
    expect(announcer.announce).not.toHaveBeenCalled();
  });

  it('contextmenu falls back to wsService.sendCancelPromptSequence when no local Cancel button exists', () => {
    openDialog();

    const prevent = jasmine.createSpy('preventDefault');
    component.handleContextMenu({ preventDefault: prevent } as unknown as MouseEvent);

    expect(prevent).toHaveBeenCalled();
    expect(ws.sendCancelPromptSequence).toHaveBeenCalledTimes(1);
    expect(announcer.announce).toHaveBeenCalled();
  });

  it('contextmenu is a no-op in readOnly mode (replay) — no cancel sent', () => {
    fixture.componentRef.setInput('readOnly', true);
    openDialog();

    const prevent = jasmine.createSpy('preventDefault');
    component.handleContextMenu({ preventDefault: prevent } as unknown as MouseEvent);

    expect(prevent).not.toHaveBeenCalled();
    expect(ws.sendCancelPromptSequence).not.toHaveBeenCalled();
  });

  it('contextmenu is a no-op when dialogState is not "open" (closed/collapsed)', () => {
    expect(component.dialogState()).toBe('closed');

    const prevent = jasmine.createSpy('preventDefault');
    component.handleContextMenu({ preventDefault: prevent } as unknown as MouseEvent);

    expect(prevent).not.toHaveBeenCalled();
    expect(ws.sendCancelPromptSequence).not.toHaveBeenCalled();
  });

  it('readOnly=true + SELECT_IDLECMD opens dialog and mounts a sub-component (replay action-list path)', () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.componentRef.setInput('prompt', makeIdleCmdPrompt());
    fixture.detectChanges();

    // In readOnly mode, IDLECMD is no longer ignored — it routes to
    // PromptActionListReadonlyComponent. The dialog must open and mount.
    expect(component.dialogState()).toBe('open');
    expect(component.portalOutlet.hasAttached()).toBe(true);
  });
});

// =============================================================================
// PvpPromptDialogComponent — overlayActive gate (Approach A, bug 2026-06-03)
//
// The dialog defers its visible open transition until the chain overlay has
// finished its card-level animation (entry / pulse). Three contracts under
// test :
//   1. Prompt arrives with `overlayActive=true` → dialog stays `closed`
//      (sub-component is prepared on the portal so re-open is instant).
//   2. `overlayActive` flips false → dialog opens.
//   3. Race condition : prompt arrives with `overlayActive=false` synchronously
//      BUT `overlayActive` flips to true within the same microtask (the chain
//      overlay's `_runOverlayShowSequence` fires from a deferred effect that
//      lands AFTER the prompt-dialog effect in the Angular flush order) →
//      dialog must NOT open, because the open is deferred via `queueMicrotask`
//      which re-checks `overlayActive` before committing.
//
// Cf. session log 2026-06-03 — race tracked via a Playwright spec showing
// `openForPrompt overlayActive=false setOpen=true` followed 3ms later by
// `_runOverlayShowSequence` then `openForPrompt overlayActive=true setOpen=false`.
// The microtask defer makes the open-decision converge on the correct state.
// =============================================================================

describe('PvpPromptDialogComponent — overlayActive gate (Approach A, 2026-06-03)', () => {
  let ws: WsStub;
  let fixture: ComponentFixture<PvpPromptDialogComponent>;
  let component: PvpPromptDialogComponent;
  let originalMap: Record<string, unknown>;

  beforeEach(() => {
    originalMap = { ...PROMPT_COMPONENT_MAP };
    for (const k of Object.keys(PROMPT_COMPONENT_MAP)) delete PROMPT_COMPONENT_MAP[k];
    PROMPT_COMPONENT_MAP['SELECT_YESNO'] = StubYesNoComponent;
    PROMPT_COMPONENT_MAP['SELECT_OPTION'] = StubOptionComponent;

    ws = makeWsStub();

    TestBed.configureTestingModule({
      imports: [PvpPromptDialogComponent],
      providers: [
        { provide: DuelWebSocketService, useValue: ws },
        { provide: TranslateService, useValue: {
          instant: (k: string) => k,
          get: (k: string) => ({ subscribe: (fn: (v: string) => void) => fn(k) }),
          onLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onTranslationChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onDefaultLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
        } },
        { provide: LiveAnnouncer, useValue: { announce: jasmine.createSpy('announce') } },
        ...descriptionServiceStubs(),
      ],
    });

    fixture = TestBed.createComponent(PvpPromptDialogComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    for (const k of Object.keys(PROMPT_COMPONENT_MAP)) delete PROMPT_COMPONENT_MAP[k];
    Object.assign(PROMPT_COMPONENT_MAP, originalMap);
  });

  it('default overlayActive=false → dialog opens normally', () => {
    fixture.detectChanges();
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
    expect(component.dialogState()).toBe('open');
  });

  it('prompt arriving with overlayActive=true → dialog stays closed (sub-component prepared on portal)', () => {
    fixture.componentRef.setInput('overlayActive', true);
    fixture.detectChanges();

    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();

    // Dialog deferred — visible state = closed.
    expect(component.dialogState()).toBe('closed');
    // Sub-component IS already attached to the portal so the eventual open
    // animates instantly (no FOUC).
    expect(component.portalOutlet.hasAttached()).toBe(true);
  });

  it('overlayActive flips false while prompt is present → dialog opens', () => {
    fixture.componentRef.setInput('overlayActive', true);
    fixture.detectChanges();
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
    expect(component.dialogState()).toBe('closed');

    fixture.componentRef.setInput('overlayActive', false);
    fixture.detectChanges();
    expect(component.dialogState()).toBe('open');
  });

  it('overlayActive flips true while dialog is open → dialog closes (defensive re-gate)', () => {
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
    expect(component.dialogState()).toBe('open');

    fixture.componentRef.setInput('overlayActive', true);
    fixture.detectChanges();
    // The lifecycle effect re-fires when overlayActive flips ; openForPrompt
    // is called again with the same prompt object and detects
    // overlayActive=true → forces dialogState=closed. This catches the
    // intra-tick race condition where the prompt-dialog effect would have
    // opened the dialog before the chain-overlay effect flipped
    // overlayActive to true (the original 2026-06-03 bug 2).
    expect(component.dialogState()).toBe('closed');
  });

  it('does not re-swapComponent on re-entry with the same prompt object (avoid destroying sub-component state)', () => {
    fixture.componentRef.setInput('prompt', makeYesNoPrompt());
    fixture.detectChanges();
    const firstRef = component.portalOutlet.attachedRef as { instance: unknown };
    expect(firstRef.instance).toBeInstanceOf(StubYesNoComponent);

    // Flip overlayActive a few times — lifecycle effect re-fires, openForPrompt
    // is called again with the SAME prompt object. _mountedPromptOnPortal
    // must short-circuit swapComponent so the instance survives.
    fixture.componentRef.setInput('overlayActive', true);
    fixture.detectChanges();
    fixture.componentRef.setInput('overlayActive', false);
    fixture.detectChanges();

    const finalRef = component.portalOutlet.attachedRef as { instance: unknown };
    expect(finalRef.instance).toBe(firstRef.instance);
  });
});
