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
  hintContext: WritableSignal<{ hintType: number; player: number; value: number; cardName: string; hintAction: string }>;
  activeChainLinks: WritableSignal<Array<{ chainIndex: number; resolving: boolean; negated: boolean; cardCode: number; cardName: string; player: number; zoneId: string; location: number; sequence: number }>>;
  rpsInProgress: WritableSignal<boolean>;
  tpResponseSent: WritableSignal<boolean>;
  lastConfirmedCards: CardInfo[];
  lastSelectedCards: CardInfo[];
  confirmedCardsForChainIndex: jasmine.Spy;
  sendResponse: jasmine.Spy;
  sendCancelPromptSequence: jasmine.Spy;
}

function makeWsStub(): WsStub {
  return {
    hintContext: signal({ hintType: 0, player: 0, value: 0, cardName: '', hintAction: '' }),
    activeChainLinks: signal([] as WsStub['activeChainLinks'] extends WritableSignal<infer T> ? T : never),
    rpsInProgress: signal(false),
    tpResponseSent: signal(false),
    lastConfirmedCards: [] as CardInfo[],
    lastSelectedCards: [] as CardInfo[],
    confirmedCardsForChainIndex: jasmine.createSpy('confirmedCardsForChainIndex').and.returnValue([] as CardInfo[]),
    sendResponse: jasmine.createSpy('sendResponse'),
    sendCancelPromptSequence: jasmine.createSpy('sendCancelPromptSequence'),
  };
}

function makeYesNoPrompt(): Prompt {
  return {
    type: 'SELECT_YESNO',
    player: 0,
    descriptionText: 'Activate effect?',
    cardName: 'Test Card',
  } as unknown as Prompt;
}

function makeOptionPrompt(): Prompt {
  return {
    type: 'SELECT_OPTION',
    player: 0,
    options: [{ description: 'A' }, { description: 'B' }],
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

  it('does not auto-close while rpsInProgress is true', () => {
    // Open via passive message during RPS.
    ws.rpsInProgress.set(true);
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
});
