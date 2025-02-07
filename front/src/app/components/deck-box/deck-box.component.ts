import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ShortDeck } from '../../core/model/short-deck';

@Component({
  selector: 'deck-box',
  imports: [CommonModule, MatIconModule, RouterLink],
  templateUrl: './deck-box.component.html',
  styleUrl: './deck-box.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckBoxComponent {
  readonly deck = input<ShortDeck>();
  readonly add = input<boolean>(false);

  constructor() {}
}
