/**
 * Spec for EffectBubbleComponent — Surface 2 of the Game Log feature.
 *
 * The component reads `DuelGameLogService.lastOpponentActivation` and drives a
 * CDK overlay anchored on the opponent duelist card. The spec stubs the service
 * with a writable feed signal, injects a fake anchor element into the DOM, and
 * asserts the rendered bubble + its last-wins / anti-flicker timing.
 *
 * `feed.set()` schedules the component's feed `effect`; the spec flushes it
 * with `TestBed.flushEffects()`, then `detectChanges()` renders the overlay's
 * embedded view.
 */

import { signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { OverlayContainer, OverlayModule } from '@angular/cdk/overlay';
import { LiveAnnouncer } from '@angular/cdk/a11y';

import { EffectBubbleComponent } from './effect-bubble.component';
import { DuelContext } from '../duel-context';
import { DuelGameLogService, type OpponentActivation } from '../duel-game-log.service';
import {
  EFFECT_BUBBLE_FADE_MS,
  EFFECT_BUBBLE_MIN_VISIBLE_MS,
  EFFECT_BUBBLE_MS,
} from '../animation-constants';

function activation(cardName: string, descriptionText = 'effet'): OpponentActivation {
  return { cardCode: 12345, cardName, descriptionText };
}

describe('EffectBubbleComponent', () => {
  let fixture: ComponentFixture<EffectBubbleComponent>;
  let feed: ReturnType<typeof signal<OpponentActivation | null>>;
  let overlayContainer: OverlayContainer;
  let anchor: HTMLElement;

  /** The bubble content inside the CDK overlay, or null when not rendered. */
  function bubbleEl(): HTMLElement | null {
    return overlayContainer.getContainerElement().querySelector('.effect-bubble');
  }
  function bubbleCardName(): string {
    return bubbleEl()?.querySelector('.effect-bubble__card')?.textContent?.trim() ?? '';
  }
  /** The bubble's effect-text box, or null when it was not rendered. */
  function bubbleTextEl(): HTMLElement | null {
    return bubbleEl()?.querySelector('.effect-bubble__text') ?? null;
  }
  /** Push a new feed value and let the effect + CD settle. */
  function emit(value: OpponentActivation | null): void {
    feed.set(value);
    fixture.detectChanges(); // flush the feed effect + render the embedded view
  }

  beforeEach(() => {
    feed = signal<OpponentActivation | null>(null);

    // The bubble anchors its CDK overlay on the opponent duelist card —
    // inject a stand-in element so `flexibleConnectedTo` resolves.
    anchor = document.createElement('app-pvp-player-card');
    anchor.classList.add('host--opponent');
    document.body.appendChild(anchor);

    const gameLogStub: Partial<DuelGameLogService> = {
      lastOpponentActivation: feed.asReadonly(),
    };

    TestBed.configureTestingModule({
      imports: [EffectBubbleComponent, OverlayModule],
      providers: [
        DuelContext,
        { provide: DuelGameLogService, useValue: gameLogStub },
        { provide: LiveAnnouncer, useValue: jasmine.createSpyObj('LiveAnnouncer', ['announce']) },
      ],
    });

    // `scaledDuration` reads `speedMultiplier` — configure at 1x.
    TestBed.inject(DuelContext).configure({
      ownPlayerIndex: () => 0,
      speedMultiplier: () => 1,
      isBoardActive: () => true,
    });

    overlayContainer = TestBed.inject(OverlayContainer);
    fixture = TestBed.createComponent(EffectBubbleComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    anchor.remove();
  });

  it('shows the bubble when an opponent activation is fed', fakeAsync(() => {
    expect(bubbleEl()).toBeNull();

    emit(activation('Card A'));

    expect(bubbleEl()).not.toBeNull();
    expect(bubbleCardName()).toBe('Card A');

    flush();
  }));

  it('fades the bubble out once the hold window elapses', fakeAsync(() => {
    emit(activation('Card A'));
    expect(bubbleEl()).not.toBeNull();

    // Still visible just before the hold elapses.
    tick(EFFECT_BUBBLE_MS - 1);
    fixture.detectChanges();
    expect(bubbleEl()).not.toBeNull();

    // Hold elapsed → exit fade → overlay detached.
    tick(1 + EFFECT_BUBBLE_FADE_MS);
    fixture.detectChanges();
    expect(bubbleEl()).toBeNull();

    flush();
  }));

  it('replaces content and restarts the timer on a later activation', fakeAsync(() => {
    emit(activation('Card A'));

    // Let the anti-flicker floor elapse so the next activation replaces at once.
    tick(EFFECT_BUBBLE_MIN_VISIBLE_MS);

    emit(activation('Card B'));
    expect(bubbleCardName()).toBe('Card B');

    // The timer restarted with Card B — the bubble is still up at a point that
    // would have been past Card A's original hold.
    tick(EFFECT_BUBBLE_MS - 1);
    fixture.detectChanges();
    expect(bubbleCardName()).toBe('Card B');

    tick(1 + EFFECT_BUBBLE_FADE_MS);
    fixture.detectChanges();
    expect(bubbleEl()).toBeNull();

    flush();
  }));

  it('coalesces a rapid burst — no strobe, the last link wins', fakeAsync(() => {
    // Three activations fired inside the anti-flicker floor window.
    emit(activation('Link 1'));
    expect(bubbleCardName()).toBe('Link 1');

    tick(50);
    emit(activation('Link 2'));
    // Link 2 is parked behind the floor — Link 1 still on screen (no strobe).
    expect(bubbleCardName()).toBe('Link 1');

    tick(50);
    emit(activation('Link 3'));
    // Still Link 1 — last-wins means only Link 3 (the latest) is parked.
    expect(bubbleCardName()).toBe('Link 1');

    // Once the floor elapses the parked content swaps in — straight to Link 3,
    // Link 2 was overwritten while parked.
    tick(EFFECT_BUBBLE_MIN_VISIBLE_MS);
    fixture.detectChanges();
    expect(bubbleCardName()).toBe('Link 3');

    flush();
  }));

  it('dismisses immediately when the feed is cleared (reset / seek)', fakeAsync(() => {
    emit(activation('Card A'));
    expect(bubbleEl()).not.toBeNull();

    // The service's reset() nulls the feed — the bubble drops with no exit anim.
    emit(null);
    expect(bubbleEl()).toBeNull();

    flush();
  }));

  // ── compact bubble — empty descriptionText (Lot 1b) ─────────────────────────
  it('renders the effect-text box when descriptionText is present', fakeAsync(() => {
    emit(activation('Card A', 'Special Summon 1 monster'));
    const text = bubbleTextEl();
    expect(text).not.toBeNull();
    expect(text!.textContent?.trim()).toBe('Special Summon 1 monster');
    flush();
  }));

  it('renders a compact bubble — no effect-text box — when descriptionText is empty', fakeAsync(() => {
    // OCGCore emitted no disambiguation string: the bubble shows ⚡ + name
    // only. The text zone retracts (the `@if` renders nothing) so the bubble
    // closes cleanly around its header — no empty gap.
    emit(activation('Card A', ''));

    // The bubble itself still shows on an opponent activation (never hidden).
    expect(bubbleEl()).not.toBeNull();
    expect(bubbleCardName()).toBe('Card A');
    // …but the effect-text box is absent from the DOM, not an empty element.
    expect(bubbleTextEl()).toBeNull();

    flush();
  }));

  it('clears its hold timer on destroy', fakeAsync(() => {
    emit(activation('Card A'));

    fixture.destroy();
    // No pending timer should survive destruction — flush must not throw.
    expect(() => flush()).not.toThrow();
  }));
});
