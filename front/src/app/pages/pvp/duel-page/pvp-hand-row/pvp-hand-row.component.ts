import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';
import { CardOnField } from '../../duel-ws.types';
import { getCardImageUrl } from '../../pvp-card.utils';

@Component({
  selector: 'app-pvp-hand-row',
  templateUrl: './pvp-hand-row.component.html',
  styleUrl: './pvp-hand-row.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvpHandRowComponent {
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  readonly hoveredIndex = signal<number | null>(null);
  readonly selectedIndex = signal<number | null>(null);
  private readonly isSmallViewport = signal(false);

  readonly side = input.required<'player' | 'opponent'>();
  readonly cards = input<CardOnField[]>([]);
  readonly actionableCardIndices = input<Set<number>>(new Set());
  readonly activateCardIndices = input<Set<number>>(new Set());
  /** Specific card indices to hide (hand masking for draw/move-to-hand animations). */
  readonly hiddenIndices = input<ReadonlySet<number>>(new Set());
  /** Hide the entire hand (initial draw pending). */
  readonly hideAll = input(false);
  /** Chain link badges: hand card index → chain link number. */
  readonly chainBadges = input<Map<number, number>>(new Map());

  readonly handCardAction = output<{ index: number; element: HTMLElement }>();
  readonly cardInspectRequest = output<{ cardCode: number }>();

  constructor() {
    const mql = window.matchMedia('(max-height: 500px)');
    this.isSmallViewport.set(mql.matches);
    const handler = (e: MediaQueryListEvent) => this.isSmallViewport.set(e.matches);
    mql.addEventListener('change', handler);
    this.destroyRef.onDestroy(() => mql.removeEventListener('change', handler));

    effect(() => {
      if (this.actionableCardIndices().size === 0) this.selectedIndex.set(null);
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.selectedIndex() === null && this.hoveredIndex() === null) return;
    if (!this.el.nativeElement.contains(event.target as Node)) {
      this.selectedIndex.set(null);
      this.hoveredIndex.set(null);
    }
  }

  readonly needsOverlap = computed(() => this.cards().length >= 2);

  readonly overlapMargin = computed(() => {
    const count = this.cards().length;
    if (count < 2) return null;
    let ratio: number;
    if (this.isSmallViewport()) {
      // Mobile: minimal overlap for easy tap targets
      if (count <= 6) ratio = -0.05;
      else ratio = -0.05 - (count - 6) * 0.02;
    } else {
      // Desktop: tighter overlap
      if (count <= 4) ratio = -0.33;
      else if (count <= 7) ratio = -0.41;
      else ratio = -0.41 - (count - 7) * 0.04;
    }
    return `calc(var(--pvp-hand-card-height) * ${ratio})`;
  });

  private readonly FAN_MAX_ANGLE = 4;
  private readonly FAN_MAX_Y = 8;

  fanTransform(index: number): string {
    const count = this.cards().length;
    if (count <= 1) return '';
    const t = (index - (count - 1) / 2) / ((count - 1) / 2);
    const angle = t * this.FAN_MAX_ANGLE;
    const yOffset = Math.abs(t) * this.FAN_MAX_Y;
    const isPlayer = this.side() === 'player';
    const y = isPlayer ? yOffset : -yOffset;
    return `rotate(${angle}deg) translateY(${y}px)`;
  }

  readonly getCardImageUrl = getCardImageUrl;

  isPlayerSide(): boolean {
    return this.side() === 'player';
  }

  onContainerMouseMove(event: MouseEvent): void {
    if (this.side() !== 'player') return;
    const cardEls = (this.el.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.hand-card');
    let best = -1, minDist = Infinity, cardWidth = 0;
    cardEls.forEach((el, i) => {
      const { left, width } = el.getBoundingClientRect();
      const dist = Math.abs(event.clientX - (left + width / 2));
      if (dist < minDist) { minDist = dist; best = i; cardWidth = width; }
    });
    this.hoveredIndex.set(best !== -1 && minDist <= cardWidth / 2 ? best : null);
  }

  onContainerMouseLeave(): void {
    this.hoveredIndex.set(null);
  }

  onCardTap(index: number, event: MouseEvent): void {
    this.selectedIndex.set(index);
    const card = this.cards()[index];
    this.cardInspectRequest.emit({ cardCode: card?.cardCode ?? 0 });
    if (this.side() === 'player' && this.actionableCardIndices().has(index)) {
      this.handCardAction.emit({ index, element: event.currentTarget as HTMLElement });
    }
  }
}
