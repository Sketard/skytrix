import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NavbarCollapseService } from '../../services/navbar-collapse.service';

@Component({
  selector: 'app-bottom-sheet',
  templateUrl: './bottom-sheet.component.html',
  styleUrl: './bottom-sheet.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscapeKey()',
  },
})
export class BottomSheetComponent implements OnInit, OnDestroy {
  readonly opened = input(false);
  readonly cardDragActive = input(false);
  readonly ariaLabel = input('Panneau de recherche de cartes');
  readonly requestedSnap = input<'half' | 'full' | 'collapsed' | null>(null);
  readonly closed = output<void>();

  readonly sheetState = signal<'closed' | 'collapsed' | 'half' | 'full'>('closed');
  private readonly previousSnapState = signal<'half' | 'full' | 'collapsed' | null>(null);
  readonly translateY = signal(window.visualViewport?.height ?? window.innerHeight);
  readonly viewportHeight = signal(window.visualViewport?.height ?? window.innerHeight);
  readonly isDragging = signal(false);

  readonly snapHalf = computed(() => this.viewportHeight() * 0.4);
  readonly snapFull = computed(() => NavbarCollapseService.MOBILE_HEADER_HEIGHT);
  readonly snapCollapsed = computed(() => this.viewportHeight() * 0.85);
  readonly snapClose = computed(() => this.viewportHeight());

  readonly sheetTransform = computed(() => `translateY(${this.translateY()}px)`);

  private startPointerY = 0;
  private startTranslateY = 0;
  private activePointerId: number | null = null;
  private rafId = 0;
  private pendingPointerY = 0;
  private pointerHistory: Array<{ y: number; time: number }> = [];

  private static readonly VELOCITY_THRESHOLD = 0.5; // px/ms
  private static readonly MAX_HISTORY = 5;

  constructor() {
    effect(() => {
      const isOpen = this.opened();
      untracked(() => {
        if (isOpen) {
          this.snapTo('half');
        } else if (this.sheetState() !== 'closed') {
          this.previousSnapState.set(null);
          this.snapTo('closed');
        }
      });
    });

    // requestedSnap must transition through null between different states.
    // Direct changes (e.g., 'full' → 'collapsed') are ignored by design.
    effect(() => {
      const requested = this.requestedSnap();
      untracked(() => {
        const state = this.sheetState();
        if (state === 'closed') return;
        const previousSnap = this.previousSnapState();
        if (requested && previousSnap === null) {
          this.previousSnapState.set(state);
          this.snapTo(requested);
        } else if (!requested && previousSnap !== null) {
          this.snapTo(previousSnap);
          this.previousSnapState.set(null);
        }
      });
    });
  }

  ngOnInit(): void {
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.onViewportResize);
    }
  }

  ngOnDestroy(): void {
    window.visualViewport?.removeEventListener('resize', this.onViewportResize);
    cancelAnimationFrame(this.rafId);
  }

  private onViewportResize = (): void => {
    this.viewportHeight.set(window.visualViewport!.height);
    if (this.sheetState() !== 'closed') {
      this.snapTo(this.sheetState());
    }
  };

  onPointerDown(event: PointerEvent): void {
    if (this.activePointerId !== null) return;
    this.activePointerId = event.pointerId;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.isDragging.set(true);
    this.startPointerY = event.clientY;
    this.startTranslateY = this.translateY();
    this.pointerHistory = [{ y: event.clientY, time: event.timeStamp }];
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.isDragging() || event.pointerId !== this.activePointerId) return;

    this.pendingPointerY = event.clientY;
    this.pointerHistory.push({ y: event.clientY, time: event.timeStamp });
    if (this.pointerHistory.length > BottomSheetComponent.MAX_HISTORY) {
      this.pointerHistory.shift();
    }

    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => {
      const deltaY = this.pendingPointerY - this.startPointerY;
      this.translateY.set(Math.max(this.snapFull(), this.startTranslateY + deltaY));
    });
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.isDragging() || event.pointerId !== this.activePointerId) return;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    this.activePointerId = null;
    this.isDragging.set(false);
    cancelAnimationFrame(this.rafId);

    // Apply final position synchronously for accurate snap calculation
    const deltaY = event.clientY - this.startPointerY;
    this.translateY.set(Math.max(this.snapFull(), this.startTranslateY + deltaY));

    const velocity = this.calculateVelocity();
    const midHalfCollapsed = (this.snapHalf() + this.snapCollapsed()) / 2;
    if (velocity > BottomSheetComponent.VELOCITY_THRESHOLD) {
      if (this.translateY() < midHalfCollapsed) {
        this.snapTo('collapsed');
      } else {
        this.dismiss();
      }
    } else if (velocity < -BottomSheetComponent.VELOCITY_THRESHOLD) {
      this.snapTo('full');
    } else {
      this.snapToNearest();
    }
  }

  onBackdropClick(): void {
    this.dismiss();
  }

  onEscapeKey(): void {
    if (this.sheetState() !== 'closed') {
      this.dismiss();
    }
  }

  private dismiss(): void {
    this.sheetState.set('closed');
    this.translateY.set(this.snapClose());
    this.previousSnapState.set(null);
    this.closed.emit();
  }

  private snapTo(state: 'half' | 'full' | 'collapsed' | 'closed'): void {
    this.sheetState.set(state);
    switch (state) {
      case 'half':
        this.translateY.set(this.snapHalf());
        break;
      case 'full':
        this.translateY.set(this.snapFull());
        break;
      case 'collapsed':
        this.translateY.set(this.snapCollapsed());
        break;
      case 'closed':
        this.translateY.set(this.snapClose());
        break;
    }
  }

  private snapToNearest(): void {
    const current = this.translateY();
    const full = this.snapFull();
    const half = this.snapHalf();
    const collapsed = this.snapCollapsed();
    const close = this.snapClose();

    const midFullHalf = (full + half) / 2;
    const midHalfCollapsed = (half + collapsed) / 2;
    const dismissThreshold = collapsed + (close - collapsed) * 0.4;

    if (current > dismissThreshold) {
      this.dismiss();
    } else if (current > midHalfCollapsed) {
      this.snapTo('collapsed');
    } else if (current > midFullHalf) {
      this.snapTo('half');
    } else {
      this.snapTo('full');
    }
  }

  private calculateVelocity(): number {
    if (this.pointerHistory.length < 2) return 0;
    const last = this.pointerHistory[this.pointerHistory.length - 1];
    const first = this.pointerHistory[0];
    const timeDelta = last.time - first.time;
    if (timeDelta === 0) return 0;
    return (last.y - first.y) / timeDelta;
  }
}
