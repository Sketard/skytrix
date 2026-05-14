import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { DuelWebSocketService } from '../duel-web-socket.service';
import { DuelCardArtService } from '../duel-card-art.service';
import { DiceResultMsg } from '../../duel-ws.types';
import {
  DICE_AUTO_ROLL_DELAY_MS,
  DICE_ROLL_ANIM_DURATION_MS,
  DICE_FINAL_ANNOUNCE_MS,
} from '../../pvp-timings';

/** Pre-duel dice arena (Phase 3.14, since 2026-05-13). Owns the full
 *  pre-duel UX between waiting-room → board:
 *   - Stage 1 "ready"   — visible while DICE_ROLL prompt is pending,
 *                         auto-rolls after DICE_AUTO_ROLL_DELAY_MS.
 *   - Stage 2 "rolling" — dice physics 1.8s while `diceInProgress=true`.
 *   - Stage 3 "result"  — final pose + roll-vs-strip + outcome sub-block
 *                         (won = SELECT_FIRST_PLAYER pick, lost = spinner,
 *                         draw = auto re-roll banner).
 *   - Stage 4 "final"   — "You go first / second" announce (~2.5s) after
 *                         FIRST_PLAYER_RESULT.
 *
 *  DICE_ROLL + SELECT_FIRST_PLAYER are NOT routed through the prompt
 *  dialog any more — this arena owns them end-to-end. */
type Stage = 'idle' | 'ready' | 'rolling' | 'result' | 'final';
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
  private prewarmedForDuel = false;

  readonly stage = signal<Stage>('idle');
  readonly turnChoice = signal<TurnChoice>('first');
  readonly diceResult = computed(() => this.ws.diceResult());
  readonly firstPlayerResult = computed(() => this.ws.firstPlayerResult());
  // Used by the template to disable the two turn-choice buttons once the
  // user has clicked one (single-shot — the response is fire-and-confirm).
  readonly firstPlayerResponseSent = computed(() => this.ws.firstPlayerResponseSent());

  /** Displayed dice values after the rolling animation lands. We mirror the
   *  server's DICE_RESULT here so Stage 2 can pin to the right face. Reset on
   *  re-rolls (draw). */
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

  /** Server filterMessage swaps DICE_RESULT per-player so the receiving
   *  client always reads `dice0`/`sum0` as its OWN side and `winner === 0`
   *  as "I won". See duel-server/src/message-filter.ts:135. */
  readonly outcome = computed((): 'won' | 'lost' | 'draw' | null => {
    const r = this.diceResult();
    if (!r) return null;
    if (r.winner === null) return 'draw';
    return r.winner === 0 ? 'won' : 'lost';
  });

  private rollTimer: ReturnType<typeof setTimeout> | null = null;
  private finalTimer: ReturnType<typeof setTimeout> | null = null;
  private animationStartedFor: DiceResultMsg | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimers());

    // Drive stage transitions off the WS signals. We don't subscribe to
    // pendingPrompt directly — Stage 1 is gated on a DICE_ROLL prompt being
    // visible (and the response not yet sent).
    effect(() => {
      const prompt = this.ws.pendingPrompt();
      const inProgress = this.ws.diceInProgress();
      const result = this.diceResult();
      const finalRes = this.firstPlayerResult();
      untracked(() => this.recomputeStage(prompt?.type ?? null, inProgress, result, finalRes));
    });
  }

  private recomputeStage(
    promptType: string | null,
    inProgress: boolean,
    result: DiceResultMsg | null,
    finalRes: { goFirst: boolean } | null,
  ): void {
    if (finalRes) {
      if (this.stage() !== 'final') {
        this.stage.set('final');
        this.scheduleFinalDismiss();
        // Phase 3.16: piggyback the 2.5s announce window to warm the browser
        // image cache for the local deck. DUEL_STARTING has already landed
        // (it precedes FIRST_PLAYER_RESULT), so ws.cardCodes() is populated.
        // prefetchCard is idempotent + fire-and-forget so this is safe even
        // if any code is already cached or the announce gets dismissed early.
        this.prewarmDeckArt();
      }
      return;
    }

    if (result) {
      if (this.animationStartedFor !== result) {
        this.animationStartedFor = result;
        // Bind dice values BEFORE entering 'rolling' so the tumble keyframes
        // and the post-roll resting pose target the same face — the cube
        // visually settles on the final value rather than snapping at the end.
        // Server filterMessage swaps dice0/dice1 per recipient so dice0 is
        // ALWAYS the local player's roll (see message-filter.ts:135).
        this.resultMy.set(result.dice0);
        this.resultOpp.set(result.dice1);
        this.stage.set('rolling');
        this.clearRollTimer();
        this.rollTimer = setTimeout(() => {
          this.stage.set('result');
        }, DICE_ROLL_ANIM_DURATION_MS);
      }
      return;
    }

    // No result yet — either pending prompt (auto-roll), in-progress, or idle.
    if (inProgress) {
      // DICE_ROLL response sent, server rolling. Already in rolling stage if we
      // got here from Stage 1's auto-roll; otherwise enter rolling on reconnect.
      if (this.stage() !== 'rolling') this.stage.set('rolling');
      return;
    }

    if (promptType === 'DICE_ROLL') {
      // Fresh prompt arrived (or re-roll after draw). Show Stage 1, schedule
      // auto-roll.
      this.animationStartedFor = null;
      this.resultMy.set(null);
      this.resultOpp.set(null);
      // Rematch: a new dice flow starts → reset the prewarm latch so the
      // next `final` stage can re-prefetch (the deck may have changed).
      this.prewarmedForDuel = false;
      if (this.stage() !== 'ready') {
        this.stage.set('ready');
        this.scheduleAutoRoll();
      }
      return;
    }

    // No dice context at all → stay hidden.
    this.stage.set('idle');
  }

  private scheduleAutoRoll(): void {
    this.clearRollTimer();
    this.rollTimer = setTimeout(() => {
      const prompt = this.ws.pendingPrompt();
      if (prompt?.type !== 'DICE_ROLL') return;
      this.ws.sendResponse('DICE_ROLL', {});
    }, DICE_AUTO_ROLL_DELAY_MS);
  }

  private scheduleFinalDismiss(): void {
    this.clearFinalTimer();
    this.finalTimer = setTimeout(() => {
      // After the announce window, the server has already sent DUEL_STARTING
      // and the board takes over. We just yield the visual to idle.
      this.stage.set('idle');
    }, DICE_FINAL_ANNOUNCE_MS);
  }

  /** Fire-and-forget warmup for the deck card art during the 2.5s announce.
   *  DuelCardArtService.prefetchCard is per-code idempotent so re-entering
   *  `final` after a reconnect mid-window is a no-op. We additionally gate
   *  on a local flag so the call is made at most once per dice-arena
   *  lifecycle, keeping the hot path cheap. */
  private prewarmDeckArt(): void {
    if (this.prewarmedForDuel) return;
    const codes = this.ws.cardCodes();
    if (!codes.length) return;
    this.prewarmedForDuel = true;
    this.artService.prefetchCards(codes);
  }

  private clearTimers(): void {
    this.clearRollTimer();
    this.clearFinalTimer();
  }

  private clearRollTimer(): void {
    if (this.rollTimer) {
      clearTimeout(this.rollTimer);
      this.rollTimer = null;
    }
  }

  private clearFinalTimer(): void {
    if (this.finalTimer) {
      clearTimeout(this.finalTimer);
      this.finalTimer = null;
    }
  }

  // ---- Stage 3 (won) actions ----------------------------------------------

  /** One-shot turn-order pick — clicking a button immediately sends the
   *  SELECT_FIRST_PLAYER response (no intermediate "Launch the duel" step).
   *  The two buttons disable themselves via `firstPlayerResponseSent()` to
   *  prevent double-clicks while the response is in flight. */
  chooseAndConfirm(choice: TurnChoice): void {
    if (this.firstPlayerResponseSent()) return;
    const prompt = this.ws.pendingPrompt();
    if (prompt?.type !== 'SELECT_FIRST_PLAYER') return;
    this.turnChoice.set(choice);
    this.ws.sendResponse('SELECT_FIRST_PLAYER', { goFirst: choice === 'first' });
  }

  // Templates use these to render the 6-face dice cube. We render all 6 faces
  // always and rely on .result-N / .tumble-N to position them — same trick as
  // the mockup.
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
