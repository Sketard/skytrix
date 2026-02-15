import { ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { SharedCardInspectorData } from '../../core/model/shared-card-data';

@Component({
  selector: 'app-card-inspector',
  templateUrl: './card-inspector.component.html',
  styleUrl: './card-inspector.component.scss',
  standalone: true,
  imports: [NgTemplateOutlet],
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
  },
})
export class CardInspectorComponent {
  private readonly elementRef = inject(ElementRef);

  readonly card = input<SharedCardInspectorData | null>(null);
  readonly mode = input<'dismissable' | 'click' | 'permanent'>('dismissable');
  readonly position = input<'left' | 'right'>('left');

  readonly dismissed = output<void>();

  readonly isVisible = computed(() => this.card() !== null);

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
