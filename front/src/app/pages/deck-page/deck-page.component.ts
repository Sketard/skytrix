import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DeckListComponent } from './components/deck-list/deck-list.component';

@Component({
  selector: 'app-deck-page',
  imports: [CommonModule, DeckListComponent],
  templateUrl: './deck-page.component.html',
  styleUrl: './deck-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckPageComponent {}
