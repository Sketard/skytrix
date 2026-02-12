import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, isDevMode, ViewChild } from '@angular/core';
import { CdkDrag, CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { BoardStateService } from './board-state.service';
import { CommandStackService } from './command-stack.service';
import { createGlowEffect } from './glow-effect';
import { CardInstance, ZoneId, ZONE_CONFIG } from './simulator.models';
import { CardType } from '../../core/enums/card-type.enum';
import { SimCardComponent } from './sim-card.component';

@Component({
  selector: 'app-sim-zone',
  templateUrl: './zone.component.html',
  styleUrl: './zone.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DragDropModule, SimCardComponent, MatMenuModule, MatIconModule],
})
export class SimZoneComponent {
  readonly zoneId = input.required<ZoneId>();

  @ViewChild('cardMenuTrigger') cardMenuTrigger?: MatMenuTrigger;
  @ViewChild('menuAnchor') menuAnchor?: ElementRef<HTMLElement>;

  private readonly boardState = inject(BoardStateService);
  private readonly commandStack = inject(CommandStackService);

  readonly card = computed(() => this.boardState.boardState()[this.zoneId()]?.[0] ?? null);
  readonly zoneConfig = computed(() => ZONE_CONFIG[this.zoneId()]);
  readonly isPendulum = computed(() => !!this.zoneConfig().pendulum);
  readonly pendulumLabel = computed(() => this.zoneConfig().pendulum === 'left' ? 'P-L' : 'P-R');
  private readonly glow = createGlowEffect();
  readonly justDropped = this.glow.justDropped;
  readonly onGlowAnimationEnd = this.glow.onGlowAnimationEnd;

  readonly isMonsterZone = computed(() => {
    const config = this.zoneConfig();
    return config.type === 'single' && [
      ZoneId.MONSTER_1, ZoneId.MONSTER_2, ZoneId.MONSTER_3,
      ZoneId.MONSTER_4, ZoneId.MONSTER_5,
      ZoneId.EXTRA_MONSTER_L, ZoneId.EXTRA_MONSTER_R,
    ].includes(this.zoneId());
  });

  readonly isXyzMonster = computed(() =>
    this.card()?.card.card.types?.includes(CardType.XYZ) ?? false
  );

  readonly isFaceDown = computed(() => this.card()?.faceDown ?? false);
  readonly isFaceUpAtk = computed(() => {
    const c = this.card();
    return c !== null && !c.faceDown && c.position === 'ATK';
  });
  readonly isFaceUpDef = computed(() => {
    const c = this.card();
    return c !== null && !c.faceDown && c.position === 'DEF';
  });

  readonly canDrop = (drag: CdkDrag<CardInstance>): boolean => {
    const card = this.card();
    if (card === null) return true;
    if (this.isMonsterZone() && this.isXyzMonster()) return true;
    return false;
  };

  onDrop(event: CdkDragDrop<ZoneId, ZoneId, CardInstance>): void {
    if (event.previousContainer === event.container) return;
    const cardInstanceId = event.item.data.instanceId;
    const fromZone = event.previousContainer.data;
    const toZone = event.container.data;
    try {
      const existingCard = this.card();
      if (existingCard) {
        const fromCards = this.boardState.boardState()[fromZone];
        const isInMainArray = fromCards.some(c => c.instanceId === cardInstanceId);
        if (isInMainArray) {
          this.commandStack.attachMaterial(cardInstanceId, fromZone, existingCard.instanceId, toZone);
        } else {
          this.commandStack.transferMaterial(cardInstanceId, fromZone, existingCard.instanceId, toZone);
        }
      } else {
        this.commandStack.moveCard(cardInstanceId, fromZone, toZone);
      }
      this.glow.triggerGlow();
    } catch (e) {
      if (isDevMode()) console.warn('Drop failed:', e);
    }
  }

  onDragStarted(): void {
    this.boardState.isDragging.set(true);
  }

  onDragEnded(): void {
    this.boardState.isDragging.set(false);
  }

  onCardClicked(card: CardInstance): void {
    this.boardState.selectCard(card);
    if ((card.overlayMaterials?.length ?? 0) > 0) {
      this.boardState.openMaterialPeek(card.instanceId, this.zoneId());
    }
  }

  // preventDefault handled by board-level @HostListener('contextmenu')
  onContextMenu(event: MouseEvent): void {
    const c = this.card();
    if (!c) return;
    if (this.boardState.isDragging()) return;

    if (this.menuAnchor) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.menuAnchor.nativeElement.style.left = `${event.clientX - rect.left}px`;
      this.menuAnchor.nativeElement.style.top = `${event.clientY - rect.top}px`;
    }
    this.cardMenuTrigger?.openMenu();
  }

  onFlipFaceDown(): void {
    const c = this.card();
    if (!c) return;
    try {
      this.commandStack.flipCard(c.instanceId, this.zoneId(), true, 'DEF');
      this.glow.triggerGlow();
    } catch (e) {
      if (isDevMode()) console.warn('FlipFaceDown failed:', e);
    }
  }

  onFlipFaceUp(position: 'ATK' | 'DEF'): void {
    const c = this.card();
    if (!c) return;
    try {
      this.commandStack.flipCard(c.instanceId, this.zoneId(), false, position);
      this.glow.triggerGlow();
    } catch (e) {
      if (isDevMode()) console.warn('FlipFaceUp failed:', e);
    }
  }

  onTogglePosition(): void {
    const c = this.card();
    if (!c) return;
    const targetPosition = c.position === 'ATK' ? 'DEF' : 'ATK';
    try {
      this.commandStack.togglePosition(c.instanceId, this.zoneId(), targetPosition);
      this.glow.triggerGlow();
    } catch (e) {
      if (isDevMode()) console.warn('TogglePosition failed:', e);
    }
  }
}
