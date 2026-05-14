import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DuelState } from '../../types';
import type { Player, ZoneId } from '../../duel-ws.types';

const MAIN_ZONE_IDS: readonly ZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5'];
const SPELL_ZONE_IDS: readonly ZoneId[] = ['S1', 'S2', 'S3', 'S4', 'S5'];
const EMZ_ZONE_IDS: readonly ZoneId[] = ['EMZ_L', 'EMZ_R'];

// Lightweight 1:6-scale board preview rendered from a `DuelState`. Used by:
//   - TimelineBar hover popover (F3) — replaces the heavy
//     `<app-pvp-board-container [preview]>` instance the old code mounted on
//     every hover (D-decision 2026-05-14).
//   - TurnPickerSheet grid (F2) — one instance per turn × 11+ turns; perf
//     budget < 5ms per instance is the target.
//
// Layout: 4 rows × 7 cells.
//   Row 1 — opponent hand (count-only ghost cards)
//   Row 2 — opponent M1..M5 + EMZ_L + EMZ_R (monster lane)
//   Row 3 — self M1..M5 + EMZ_L + EMZ_R
//   Row 4 — self hand (count-only ghost cards)
//
// SZONE is omitted v1 — the 7-col grid would need 4 rows × 7 to fit it, and
// the timeline popover values "monsters present" much more than "trap set".
// Re-add later if QA flags it. (EMZ shows occupied state to highlight Link/
// Pendulum summons.)
//
// All visuals come from `_mini-board.scss` (Viewer F0 partial). The component
// only maps `DuelState → boolean[]` for each cell.
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
  /** Optional variant: `'picker'` shrinks the inner geometry for the grid. */
  readonly variant = input<'default' | 'picker'>('default');

  // Player at the bottom row (self) is always players[perspectiveIndex]; top
  // row (opp) is the other. The `MZONE` array always has exactly 5 entries.
  protected readonly selfPlayer = computed(() => this.state().players[this.perspectiveIndex()]);
  protected readonly oppPlayer  = computed(() => this.state().players[this.perspectiveIndex() === 0 ? 1 : 0]);

  protected readonly selfHandCount = computed(() => this.handCount(this.selfPlayer()));
  protected readonly oppHandCount  = computed(() => this.handCount(this.oppPlayer()));

  // 7-cell rows: 5 MZONE cells + 2 trailing nulls (padding to keep grid symmetric
  // with the SZONE row that future versions may add). Picker variant keeps the
  // same 7-col footprint — it's a CSS scale, not a DOM change.
  protected readonly selfMonsters = computed(() => this.monsterRow(this.selfPlayer()));
  protected readonly oppMonsters  = computed(() => this.monsterRow(this.oppPlayer()));

  protected readonly hostClass = computed(() => {
    return this.variant() === 'picker' ? 'mini-board mini-board--picker' : 'mini-board';
  });

  private handCount(player: DuelState['players'][number] | undefined): number {
    if (!player) return 0;
    return player.zones.find(z => z.zoneId === 'HAND')?.cards.length ?? 0;
  }

  // Each main / EMZ zone holds 0 or 1 cards in OCGCore's board model. A zone
  // is "occupied" when it exists in the player's zones array AND its first
  // card has a non-null cardCode (null means face-down / hidden, which still
  // counts as occupied for the thumbnail).
  private monsterRow(player: DuelState['players'][number] | undefined): boolean[] {
    if (!player) return [false, false, false, false, false, false, false];
    const ids: readonly ZoneId[] = [...MAIN_ZONE_IDS, ...EMZ_ZONE_IDS];
    return ids.map(id => {
      const zone = player.zones.find(z => z.zoneId === id);
      return (zone?.cards.length ?? 0) > 0;
    });
  }

  protected handArray(count: number): number[] {
    return Array.from({ length: Math.min(count, 7) }, (_, i) => i);
  }
}
