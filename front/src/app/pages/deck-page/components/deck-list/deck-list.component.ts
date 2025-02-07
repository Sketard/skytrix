import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DeckBuildService } from '../../../../services/deck-build.service';
import { DeckBoxComponent } from '../../../../components/deck-box/deck-box.component';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'deck-list',
  imports: [CommonModule, DeckBoxComponent, MatIconModule],
  templateUrl: './deck-list.component.html',
  styleUrl: './deck-list.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckListComponent {
  constructor(public deckBuildService: DeckBuildService) {
    this.deckBuildService.fetchDecks();
  }

  public removeDeck(id: number) {
    this.deckBuildService.deleteById(id);
  }
}
