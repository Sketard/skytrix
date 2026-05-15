import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DuelState } from '../../types';
import type { Player, ZoneId } from '../../duel-ws.types';

type PlayerState = DuelState['players'][number];

const MAIN_ZONE_IDS: readonly ZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5'];
const SPELL_ZONE_IDS: readonly ZoneId[] = ['S1', 'S2', 'S3', 'S4', 'S5'];
const EMZ_ZONE_IDS: readonly ZoneId[] = ['EMZ_L', 'EMZ_R'];

// Lightweight 1:6-scale board preview rendered from a `DuelState`. Three
// variants exposed via `[variant]` keep ONE component for two surfaces with
// different richness needs:
//
//   - `default`  — 4-row layout (hand opp / mzone opp / mzone self / hand self).
//                   The original picker-grade preview kept for back-compat.
//   - `picker`   — same DOM as default, scaled down via CSS for the mobile
//                  turn picker grid (~9 cards visible at once).
//   - `hover`    — 6-row layout + footer. Matches master's scaled board: hand,
//                  SZONE, MZONE for both players + a footer with LP / phase /
//                  turn / pile counts (DECK / GY / BANISHED / EXTRA). Used by
//                  the desktop timeline-bar hover popover where one instance
//                  shows at a time and information density wins over perf.
//
// All visuals come from `_mini-board.scss` (Viewer F0 partial). The component
// only maps `DuelState → boolean[] + counts` for each row / counter.
@Component({
  selector: 'app-mini-board-thumbnail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mini-board-thumbnail.component.html',
  styleUrl: './mini-board-thumbnail.component.scss',
})
export class MiniBoardThumbnailComponent {
  readonly state = input.required<DuelState>();
  /** 0 = self at bottom (default), 1 = self at top (perspective flipped). */
  readonly perspectiveIndex = input<Player>(0);
  readonly variant = input<'default' | 'picker' | 'hover'>('default');

  protected readonly selfPlayer = computed(() => this.state().players[this.perspectiveIndex()]);
  protected readonly oppPlayer  = computed(() => this.state().players[this.perspectiveIndex() === 0 ? 1 : 0]);

  protected readonly selfHandCount = computed(() => this.zoneCardCount(this.selfPlayer(), 'HAND'));
  protected readonly oppHandCount  = computed(() => this.zoneCardCount(this.oppPlayer(),  'HAND'));

  protected readonly selfMonsters = computed(() => this.monsterRow(this.selfPlayer()));
  protected readonly oppMonsters  = computed(() => this.monsterRow(this.oppPlayer()));

  protected readonly selfSpells   = computed(() => this.spellRow(this.selfPlayer()));
  protected readonly oppSpells    = computed(() => this.spellRow(this.oppPlayer()));

  /** Footer chip values (hover variant only — `default`/`picker` ignore these). */
  protected readonly selfLp = computed(() => this.selfPlayer()?.lp ?? 0);
  protected readonly oppLp  = computed(() => this.oppPlayer()?.lp  ?? 0);
  protected readonly selfPiles = computed(() => this.piles(this.selfPlayer()));
  protected readonly oppPiles  = computed(() => this.piles(this.oppPlayer()));
  protected readonly turnLabel = computed(() => {
    const s = this.state();
    return s.turnCount > 0 ? `T${s.turnCount}` : 'T0';
  });
  protected readonly phaseLabel = computed(() => this.state().phase);

  protected readonly hostClass = computed(() => {
    const v = this.variant();
    if (v === 'picker') return 'mini-board mini-board--picker';
    if (v === 'hover')  return 'mini-board mini-board--hover';
    return 'mini-board';
  });

  /** Hover variant gets the SZONE row + footer; default/picker keep the 4-row layout. */
  protected readonly showSpellRows = computed(() => this.variant() === 'hover');
  protected readonly showFooter    = computed(() => this.variant() === 'hover');

  private zoneCardCount(player: PlayerState | undefined, id: ZoneId): number {
    if (!player) return 0;
    return player.zones.find(z => z.zoneId === id)?.cards.length ?? 0;
  }

  private monsterRow(player: PlayerState | undefined): boolean[] {
    if (!player) return [false, false, false, false, false, false, false];
    const ids: readonly ZoneId[] = [...MAIN_ZONE_IDS, ...EMZ_ZONE_IDS];
    return ids.map(id => this.zoneCardCount(player, id) > 0);
  }

  private spellRow(player: PlayerState | undefined): boolean[] {
    if (!player) return [false, false, false, false, false, false, false];
    return SPELL_ZONE_IDS.map(id => this.zoneCardCount(player, id) > 0).concat([false, false]);
  }

  private piles(player: PlayerState | undefined): { deck: number; gy: number; banished: number; extra: number } {
    if (!player) return { deck: 0, gy: 0, banished: 0, extra: 0 };
    return {
      deck:     player.deckCount,
      extra:    player.extraCount,
      gy:       this.zoneCardCount(player, 'GY'),
      banished: this.zoneCardCount(player, 'BANISHED'),
    };
  }

  protected handArray(count: number): number[] {
    return Array.from({ length: Math.min(count, 7) }, (_, i) => i);
  }
}
