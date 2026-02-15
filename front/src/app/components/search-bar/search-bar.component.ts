import { CommonModule } from '@angular/common';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { DeckBuildService } from '../../services/deck-build.service';
import { map } from 'rxjs';
import { countValidValues } from '../../core/utilities/functions';

@Component({
  selector: 'search-bar',
  imports: [CommonModule, ReactiveFormsModule, MatInputModule, MatFormFieldModule, MatIconModule, MatIconButton],
  templateUrl: './search-bar.component.html',
  styleUrl: './search-bar.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchBarComponent {
  readonly deckBuildMode = input<boolean>(false);
  readonly form = input(new FormControl<string>(''));
  readonly filterToggled = output<void>();

  readonly numberOfActiveFilters$ = this.deckBuildService.filterForm.valueChanges.pipe(
    map(form => countValidValues(form, ['favorite', 'name']))
  );

  public clearFormControl() {
    this.deckBuildService.disableDebounceForOneRequest();
    this.form().reset();
  }

  constructor(private readonly deckBuildService: DeckBuildService) {}

  public openFilters() {
    if (this.deckBuildMode()) {
      this.deckBuildService.toggleFilters();
    }
    this.filterToggled.emit();
  }
}
