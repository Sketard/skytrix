import { ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, isDevMode, signal, untracked } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ZoneId } from './simulator.models';
import { SimZoneComponent } from './zone.component';
import { SimStackedZoneComponent } from './stacked-zone.component';
import { SimHandComponent } from './hand.component';
import { CardInspectorComponent } from '../../components/card-inspector/card-inspector.component';
import { SimPileOverlayComponent } from './pile-overlay.component';
import { SimXyzMaterialPeekComponent } from './xyz-material-peek.component';
import { BoardStateService } from './board-state.service';
import { CommandStackService } from './command-stack.service';
import { SimControlBarComponent } from './control-bar.component';
import { NavbarCollapseService } from '../../services/navbar-collapse.service';
import { SharedCardInspectorData } from '../../core/model/shared-card-data';

@Component({
  selector: 'app-sim-board',
  templateUrl: './board.component.html',
  styleUrl: './board.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DragDropModule, SimZoneComponent, SimStackedZoneComponent, SimHandComponent, CardInspectorComponent, SimPileOverlayComponent, SimXyzMaterialPeekComponent, SimControlBarComponent],
})
export class SimBoardComponent {
  protected readonly ZoneId = ZoneId;
  private readonly boardState = inject(BoardStateService);
  private readonly commandStack = inject(CommandStackService);
  private readonly navbarCollapse = inject(NavbarCollapseService);

  readonly inspectorData = computed<SharedCardInspectorData | null>(() => {
    if (this.boardState.isDragging()) return null;
    const ci = this.boardState.selectedCard();
    if (!ci) return null;
    const c = ci.card.card;
    return {
      name: c.name ?? '',
      imageUrl: ci.image.smallUrl,
      imageUrlFull: ci.image.url,
      isMonster: c.isMonster ?? false,
      attribute: c.attribute,
      race: c.race,
      level: c.level,
      scale: c.scale,
      linkval: c.linkval,
      isLink: c.isLink ?? false,
      hasDefense: c.hasDefense ?? false,
      displayAtk: c.displayAtk,
      displayDef: c.displayDef,
      description: c.description ?? '',
    };
  });

  readonly inspectorPosition = computed<'left' | 'right'>(() => 'left');

  clearSelection(): void {
    this.boardState.clearSelection();
  }

  protected readonly scaleFactor = signal(1);

  constructor() {
    effect(() => {
      this.navbarCollapse.navbarWidth();
      this.navbarCollapse.isMobile();
      untracked(() => this.recalculateScale());
    });
  }

  @HostListener('window:resize')
  onResize(): void {
    this.recalculateScale();
  }

  private recalculateScale(): void {
    const isMobile = this.navbarCollapse.isMobile();
    const availableWidth = isMobile ? window.innerWidth : window.innerWidth - this.navbarCollapse.navbarWidth();
    const availableHeight = isMobile ? window.innerHeight - NavbarCollapseService.MOBILE_HEADER_HEIGHT : window.innerHeight;
    this.scaleFactor.set(Math.min(availableWidth / 1060, availableHeight / 772, 1));
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }

    const ctrl = event.ctrlKey || event.metaKey;

    if (ctrl && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      try {
        this.commandStack.undo();
      } catch (e) {
        if (isDevMode()) console.warn('Keyboard undo failed:', e);
      }
      return;
    }

    if (ctrl && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      try {
        this.commandStack.redo();
      } catch (e) {
        if (isDevMode()) console.warn('Keyboard redo failed:', e);
      }
      return;
    }
  }
}
