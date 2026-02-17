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
  readonly closed = output<void>();

  readonly sheetState = signal<'closed' | 'half' | 'full'>('closed');
  readonly translateY = signal(window.visualViewport?.height ?? window.innerHeight);
  readonly viewportHeight = signal(window.visualViewport?.height ?? window.innerHeight);
  readonly isDragging = signal(false);

  readonly snapHalf = computed(() => this.viewportHeight() * 0.4);
  readonly snapFull = computed(() => 0);
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
          this.snapTo('closed');
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
      this.translateY.set(Math.max(0, this.startTranslateY + deltaY));
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
    this.translateY.set(Math.max(0, this.startTranslateY + deltaY));

    const velocity = this.calculateVelocity();
    if (velocity > BottomSheetComponent.VELOCITY_THRESHOLD) {
      this.dismiss();
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
    this.closed.emit();
  }

  private snapTo(state: 'half' | 'full' | 'closed'): void {
    this.sheetState.set(state);
    switch (state) {
      case 'half':
        this.translateY.set(this.snapHalf());
        break;
      case 'full':
        this.translateY.set(this.snapFull());
        break;
      case 'closed':
        this.translateY.set(this.snapClose());
        break;
    }
  }

  private snapToNearest(): void {
    const current = this.translateY();
    const half = this.snapHalf();
    const full = this.snapFull();
    const close = this.snapClose();

    const midFullHalf = (full + half) / 2;
    const dismissThreshold = half + (close - half) * 0.4;

    if (current > dismissThreshold) {
      this.dismiss();
    } else if (current < midFullHalf) {
      this.snapTo('full');
    } else {
      this.snapTo('half');
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
