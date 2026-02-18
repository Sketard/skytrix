import { ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, input, isDevMode, signal, untracked } from '@angular/core';
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

  readonly inspectorPosition = computed<'left' | 'right' | 'top'>(() =>
    this.navbarCollapse.isMobilePortrait() ? 'top' : 'left'
  );

  clearSelection(): void {
    this.boardState.clearSelection();
  }

  readonly deckId = input(0);
  protected readonly scaleFactor = signal(1);
  readonly isMobile = this.navbarCollapse.isMobile;

  private static readonly BOARD_WIDTH = 1060;
  private static readonly BOARD_HEIGHT_3ROW = 608;  // 3 zone rows only
  private static readonly HAND_GAP = 4;
  private static readonly HAND_HEIGHT = 160;
  // Desktop total: 608 + 4 + 160 = 772 (grid + gap + hand, all scaled together)
  private static readonly BOARD_HEIGHT_DESKTOP =
    SimBoardComponent.BOARD_HEIGHT_3ROW + SimBoardComponent.HAND_GAP + SimBoardComponent.HAND_HEIGHT;
  private static readonly HAND_HEIGHT_LANDSCAPE = 90;
  private static readonly HAND_HEIGHT_PORTRAIT = 120;

  constructor() {
    effect(() => {
      this.navbarCollapse.navbarWidth();
      this.navbarCollapse.isMobile();
      this.navbarCollapse.isMobilePortrait();
      this.navbarCollapse.shouldHideTopBar();
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
    const topBarVisible = isMobile && !this.navbarCollapse.shouldHideTopBar();
    const topBarHeight = topBarVisible ? NavbarCollapseService.MOBILE_HEADER_HEIGHT : 0;
    const totalHeight = window.innerHeight - topBarHeight;

    if (isMobile) {
      // Mobile: grid only (608px) — hand is native size, subtracted from available height
      const handHeight = this.navbarCollapse.isMobilePortrait()
        ? SimBoardComponent.HAND_HEIGHT_PORTRAIT
        : SimBoardComponent.HAND_HEIGHT_LANDSCAPE;
      const boardAvailableHeight = totalHeight - handHeight;
      this.scaleFactor.set(Math.min(
        availableWidth / SimBoardComponent.BOARD_WIDTH,
        boardAvailableHeight / SimBoardComponent.BOARD_HEIGHT_3ROW,
        1,
      ));
    } else {
      // Desktop: grid + gap + hand (772px) all scaled together inside .board-scaler
      this.scaleFactor.set(Math.min(
        availableWidth / SimBoardComponent.BOARD_WIDTH,
        totalHeight / SimBoardComponent.BOARD_HEIGHT_DESKTOP,
        1,
      ));
    }
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
