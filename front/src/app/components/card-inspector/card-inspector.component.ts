import { ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, inject, input, model, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { SharedCardInspectorData } from '../../core/model/shared-card-data';

@Component({
  selector: 'app-card-inspector',
  templateUrl: './card-inspector.component.html',
  styleUrl: './card-inspector.component.scss',
  standalone: true,
  imports: [NgTemplateOutlet, MatIcon, MatIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'role': 'complementary',
    '[attr.aria-label]': '"Card inspector"',
    'aria-live': 'polite',
    '[class.visible]': 'isVisible()',
    '[class.mode-dismissable]': "mode() === 'dismissable'",
    '[class.mode-click]': "mode() === 'click'",
    '[class.mode-permanent]': "mode() === 'permanent'",
    '[class.position-right]': "position() === 'right'",
    '[class.position-top]': "position() === 'top'",
  },
})
export class CardInspectorComponent {
  private readonly elementRef = inject(ElementRef);

  readonly card = input<SharedCardInspectorData | null>(null);
  readonly mode = input<'dismissable' | 'click' | 'permanent'>('dismissable');
  readonly position = input<'left' | 'right' | 'top'>('left');
  readonly ownedCount = model<number | undefined>(undefined);
  readonly isFavorite = input<boolean>(false);

  readonly dismissed = output<void>();
  readonly favoriteChange = output<boolean>();

  readonly isVisible = computed(() => this.card() !== null);
  readonly showPersonalMetadata = computed(() => this.ownedCount() !== undefined);

  changeOwned(delta: number): void {
    this.ownedCount.set(Math.max(0, (this.ownedCount() ?? 0) + delta));
  }

  toggleFavorite(): void {
    this.favoriteChange.emit(!this.isFavorite());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.isVisible()) return;
    if (this.mode() === 'permanent') return;
    this.dismissed.emit();
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMousedown(event: MouseEvent): void {
    if (!this.isVisible()) return;
    if (this.mode() !== 'dismissable') return;
    if (this.elementRef.nativeElement.contains(event.target as HTMLElement)) return;
    this.dismissed.emit();
  }
}
