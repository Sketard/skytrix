import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { DuelWebSocketService } from '../duel-web-socket.service';
import { DuelCardArtService } from '../duel-card-art.service';
import {
  DICE_AUTO_ROLL_DELAY_MS,
  DICE_ROLL_ANIM_DURATION_MS,
} from '../../pvp-timings';

/** Pre-duel dice arena. Owns the full pre-duel UX between waiting-room and
 *  the board:
 *   - `prep`    — Mounting (DICE_ROLL not yet received), shows full chrome.
 *   - `ready`   — DICE_ROLL prompt visible, auto-rolls after a short delay.
 *   - `rolling` — Dice physics animation (1.8s).
 *   - `result`  — Resting pose + roll-vs-strip + outcome sub-block:
 *                   • won → SELECT_FIRST_PLAYER turn-choice buttons
 *                   • lost → spinner "opponent choosing"
 *                   • draw → auto re-roll banner
 *   - `final`   — "Tu joues en premier/second" announce. Held until
 *                 `holdFinal` flips to false (room entered `active`).
 *   - `idle`    — Hidden.
 *
 *  Architecture: `stage` is a pure `computed` derived from reactive inputs
 *  (WS signals + 2 component inputs + 2 local timestamp signals). Side
 *  effects (auto-roll timer, prewarm, rolling-animation expiry, transient
 *  resets) live in dedicated `effect`s — never inside the stage derivation.
 *  This means stage is fully testable as a function of its inputs and the
 *  graph survives refresh + STATE_SYNC resync without flag-state drift.
 *
 *  DICE_ROLL + SELECT_FIRST_PLAYER are NOT routed through the prompt dialog;
 *  this arena owns them end-to-end. */
type Stage = 'idle' | 'prep' | 'ready' | 'rolling' | 'result' | 'final';
type TurnChoice = 'first' | 'second';

@Component({
  selector: 'app-pvp-dice-arena',
  templateUrl: './pvp-dice-arena.component.html',
  styleUrl: './pvp-dice-arena.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, TranslatePipe],
})
export class PvpDiceArenaComponent {
  private readonly ws = inject(DuelWebSocketService);
  private readonly artService = inject(DuelCardArtService);
  private readonly destroyRef = inject(DestroyRef);

  /** True while the room is in `creating-duel` or the pre-DICE_ROLL window
   *  of `connecting`. Drives the `prep` stage so the arena mounts with its
   *  full chrome (bg + title) before any WS dice context exists, replacing
   *  the legacy "PRÉPARATION DU DUEL…" full-screen flash. */
  readonly preparing = input<boolean>(false);

  /** True whenever `roomState !== 'active'`. The arena stays in `final` for
   *  the entire duration this flag is true so the announce overlay covers
   *  the gap between FIRST_PLAYER_RESULT and the board becoming visible
   *  (DECK_PREFETCH → DUEL_STARTING → BOARD_STATE → thumbnails preloaded).
   *  Flipping false drops to `idle` and reveals the board. */
  readonly holdFinal = input<boolean>(false);

  // ---- Local durable signals -----------------------------------------------

  /** True while the local rolling animation is playing — set when
   *  DICE_RESULT arrives, cleared by a setTimeout aligned to
   *  `DICE_ROLL_ANIM_DURATION_MS`. Reactive, so `stage` recomputes when
   *  the timer fires. */
  private readonly _rollingActive = signal<boolean>(false);

  /** Truthy once FIRST_PLAYER_RESULT has been seen during this dice flow.
   *  The server clears `firstPlayerResult` on DUEL_STARTING, so we can't
   *  read it back later — this signal is the durable witness that lets
   *  `stage` stay in `final` through the announce window. Reset on fresh
   *  DICE_ROLL prompt (rematch / re-roll on tie). */
  private readonly _finalSeen = signal<boolean>(false);

  /** Latched `goFirst` from FIRST_PLAYER_RESULT — kept locally because the
   *  server clears the WS signal on DUEL_STARTING, but the announce keeps
   *  rendering. Reset alongside `_finalSeen`. */
  readonly finalGoFirst = signal<boolean | null>(null);

  /** Latch: `prewarmDeckArt` runs at most once per dice lifecycle. */
  private prewarmedForDuel = false;

  /** Tracks the previous prompt type, so we detect a transition INTO
   *  DICE_ROLL (= fresh prompt) and reset transient state. */
  private prevPromptType: string | null = null;

  /** Last DICE_RESULT we bound to `resultMy`/`resultOpp`, kept by reference
   *  to detect a new result (rematch tie reroll → fresh object). */
  private animationStartedFor: unknown = null;

  // ---- Displayed dice values ----------------------------------------------

  readonly resultMy = signal<[number, number] | null>(null);
  readonly resultOpp = signal<[number, number] | null>(null);

  readonly myTotal = computed(() => {
    const r = this.resultMy();
    return r ? r[0] + r[1] : 0;
  });
  readonly oppTotal = computed(() => {
    const r = this.resultOpp();
    return r ? r[0] + r[1] : 0;
  });

  // ---- Public state for the template --------------------------------------

  /** Server filterMessage swaps DICE_RESULT per-player so the receiving
   *  client always reads `dice0`/`sum0` as its OWN side and `winner === 0`
   *  as "I won". See duel-server/src/message-filter.ts:135. */
  readonly outcome = computed((): 'won' | 'lost' | 'draw' | null => {
    const r = this.ws.diceResult();
    if (!r) return null;
    if (r.winner === null) return 'draw';
    return r.winner === 0 ? 'won' : 'lost';
  });

  /** Single source of truth for which template branch renders. */
  readonly stage = computed((): Stage => {
    const finalSeen = this._finalSeen();
    const holdFinal = this.holdFinal();
    // Once we've passed through `final`, the hold dictates whether we stay
    // on the announce overlay or yield to the board. We don't fall back to
    // `firstPlayerResult()` here — the server clears it on DUEL_STARTING.
    if (finalSeen) return holdFinal ? 'final' : 'idle';
    // Brand-new FIRST_PLAYER_RESULT arrived this tick (the `_finalSeen`
    // latch effect hasn't fired yet). Pin to `final` so the transition into
    // the announce is single-frame.
    if (this.ws.firstPlayerResult() !== null) return 'final';
    // Dice physics window — covers both the local 1.8s anim after DICE_RESULT
    // and the "inProgress" wait between sending DICE_ROLL and getting the
    // result. The local flag (`_rollingActive`) is the precise driver; the
    // remote `diceInProgress` is the fallback when we joined mid-roll.
    if (this._rollingActive()) return 'rolling';
    if (this.ws.diceResult() !== null) return 'result';
    if (this.ws.diceInProgress()) return 'rolling';
    if (this.ws.pendingPrompt()?.type === 'DICE_ROLL') return 'ready';
    if (this.preparing()) return 'prep';
    return 'idle';
  });

  /** Disables the turn-choice buttons once the response is in flight. */
  readonly firstPlayerResponseSent = computed(() => this.ws.firstPlayerResponseSent());

  // ---- Side-effect timers + latches ---------------------------------------

  private autoRollTimer: ReturnType<typeof setTimeout> | null = null;
  private rollingExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimers());

    // 1) Auto-roll on `ready` — schedule sendResponse after the intro delay.
    //    Re-evaluates on stage change; cancels itself if we leave `ready`.
    effect(() => {
      const isReady = this.stage() === 'ready';
      untracked(() => {
        this.clearAutoRollTimer();
        if (isReady) {
          this.autoRollTimer = setTimeout(() => {
            // Re-check: the prompt may have been cleared by a state-sync
            // racing with this timer.
            if (this.ws.pendingPrompt()?.type === 'DICE_ROLL') {
              this.ws.sendResponse('DICE_ROLL', {});
            }
          }, DICE_AUTO_ROLL_DELAY_MS);
        }
      });
    });

    // 2) On a new DICE_RESULT (fresh object reference), bind the displayed
    //    dice values + arm the rolling-expiry timer. The expiry resets
    //    `_rollingActive` to false, which makes `stage` flip to `result`.
    effect(() => {
      const result = this.ws.diceResult();
      untracked(() => {
        if (result === null || this.animationStartedFor === result) return;
        // Each new DICE_RESULT supersedes any in-flight rolling timer; we
        // clear it first so the last fresh result wins idempotently.
        const myToken = result;
        this.animationStartedFor = myToken;
        // Bind dice values BEFORE entering 'rolling' so the tumble keyframes
        // and the post-roll resting pose target the same face.
        this.resultMy.set(result.dice0);
        this.resultOpp.set(result.dice1);
        this._rollingActive.set(true);
        if (this.rollingExpiryTimer) clearTimeout(this.rollingExpiryTimer);
        this.rollingExpiryTimer = setTimeout(() => {
          this.rollingExpiryTimer = null;
          // Only clear if this is still our expiry (no newer result armed
          // a different timer that would have replaced animationStartedFor).
          if (this.animationStartedFor === myToken) this._rollingActive.set(false);
        }, DICE_ROLL_ANIM_DURATION_MS);
      });
    });

    // 3) Latch `_finalSeen` + `finalGoFirst` the first time
    //    FIRST_PLAYER_RESULT arrives, and prewarm the deck art cache while
    //    the announce window plays. The local `finalGoFirst` survives the
    //    server clearing `firstPlayerResult` on DUEL_STARTING, so the
    //    announce text stays correct through the entire `final` stage.
    effect(() => {
      const fp = this.ws.firstPlayerResult();
      untracked(() => {
        if (fp !== null && !this._finalSeen()) {
          this._finalSeen.set(true);
          this.finalGoFirst.set(fp.goFirst);
          this.prewarmDeckArt();
        }
      });
    });

    // 4) Detect a fresh DICE_ROLL prompt (rematch or tie reroll). Resets the
    //    per-dice-lifecycle transient state so a new run starts clean.
    effect(() => {
      const promptType = this.ws.pendingPrompt()?.type ?? null;
      untracked(() => {
        const wasDiceRoll = this.prevPromptType === 'DICE_ROLL';
        this.prevPromptType = promptType;
        if (promptType === 'DICE_ROLL' && !wasDiceRoll) {
          this.animationStartedFor = null;
          this.resultMy.set(null);
          this.resultOpp.set(null);
          this._rollingActive.set(false);
          this._finalSeen.set(false);
          this.finalGoFirst.set(null);
          this.prewarmedForDuel = false;
          if (this.rollingExpiryTimer) {
            clearTimeout(this.rollingExpiryTimer);
            this.rollingExpiryTimer = null;
          }
        }
      });
    });
  }

  /** Fire-and-forget warmup for the deck card art during the announce.
   *  DuelCardArtService.prefetchCard is per-code idempotent so re-entering
   *  `final` after a reconnect is a no-op. The local latch keeps it
   *  single-shot per dice lifecycle. */
  private prewarmDeckArt(): void {
    if (this.prewarmedForDuel) return;
    const codes = this.ws.cardCodes();
    if (!codes.length) return;
    this.prewarmedForDuel = true;
    this.artService.prefetchCards(codes);
  }

  private clearTimers(): void {
    this.clearAutoRollTimer();
    if (this.rollingExpiryTimer) { clearTimeout(this.rollingExpiryTimer); this.rollingExpiryTimer = null; }
  }

  private clearAutoRollTimer(): void {
    if (this.autoRollTimer) {
      clearTimeout(this.autoRollTimer);
      this.autoRollTimer = null;
    }
  }

  // ---- Stage 3 (won) actions ----------------------------------------------

  /** One-shot turn-order pick — clicking a button immediately sends the
   *  SELECT_FIRST_PLAYER response (no intermediate "Launch the duel" step).
   *  The two buttons disable themselves via `firstPlayerResponseSent()` to
   *  prevent double-clicks while the response is in flight. */
  readonly turnChoice = signal<TurnChoice>('first');
  chooseAndConfirm(choice: TurnChoice): void {
    if (this.firstPlayerResponseSent()) return;
    const prompt = this.ws.pendingPrompt();
    if (prompt?.type !== 'SELECT_FIRST_PLAYER') return;
    this.turnChoice.set(choice);
    this.ws.sendResponse('SELECT_FIRST_PLAYER', { goFirst: choice === 'first' });
  }

  // ---- Dice cube rendering -------------------------------------------------

  // Templates render all 6 faces always and rely on .result-N / .tumble-N
  // to position them — same trick as the mockup.
  readonly DICE_FACES = [1, 2, 3, 4, 5, 6] as const;
  readonly FACE_PIPS: Record<number, ReadonlyArray<null>> = {
    1: Array(1).fill(null),
    2: Array(2).fill(null),
    3: Array(3).fill(null),
    4: Array(4).fill(null),
    5: Array(5).fill(null),
    6: Array(6).fill(null),
  };

  /** Returns the variant class for the 3D dice cube. During `rolling`, the
   *  tumble keyframes target the upcoming face; during `result`/`final` we
   *  freeze on the same face via the resting `result-N` transform. */
  diceVariantClass(face: number | undefined): string {
    if (face === undefined) return '';
    const stage = this.stage();
    if (stage === 'rolling') return `tumble-${face}`;
    if (stage === 'result' || stage === 'final') return `result-${face}`;
    return '';
  }
}
