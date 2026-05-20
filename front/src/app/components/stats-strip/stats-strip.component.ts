import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

/** Color of the round icon avatar background + glyph. Color-named so
 *  callers map their domain semantics (e.g., decks→cyan, winrate→gold)
 *  without re-using replay-hub vocabulary in other contexts. */
export type StatIconVariant = 'cyan' | 'gold' | 'neutral';
export type StatValueVariant = 'default' | 'gold' | 'muted';
export type StatSurfaceAccent = 'cyan' | 'gold' | 'neutral';

export interface StatItem {
  /** Material icon name. Optional — when omitted, the avatar circle is skipped. */
  icon?: string;
  /** Avatar circle palette. Defaults to 'neutral'. */
  iconVariant?: StatIconVariant;
  /** Stat value (number, string, or pre-formatted "82%"). */
  value: number | string;
  /** i18n key for the small label under the value. */
  labelKey: string;
  /** Value text color. Defaults to 'default'. */
  valueVariant?: StatValueVariant;
  /** Surface card accent border (gold/cyan/neutral). Defaults to 'neutral'. */
  surfaceAccent?: StatSurfaceAccent;
}

/**
 * Generic stats strip — replaces hub-stats (replay hub) and deck-stats-strip.
 *
 * Layout:
 *  - Desktop / tablet (> 720px) : 4-col grid of surface-cards.
 *  - 480-720px : 2-col grid.
 *  - ≤ 480px (mobile portrait) : single container with vertical dividers
 *    between items, icons hidden, compact typography.
 *  - Landscape ≤ 500px tall : hidden entirely.
 */
@Component({
  selector: 'app-stats-strip',
  standalone: true,
  imports: [MatIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stats-strip.component.html',
  styleUrl: './stats-strip.component.scss',
})
export class StatsStripComponent {
  readonly stats = input.required<ReadonlyArray<StatItem>>();
  readonly ariaLabelKey = input<string>();
}
