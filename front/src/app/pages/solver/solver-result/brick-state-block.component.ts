import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-brick-state-block',
  standalone: true,
  imports: [MatIconModule, TranslatePipe],
  templateUrl: './brick-state-block.component.html',
  styleUrl: './brick-state-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrickStateBlockComponent {
  readonly brickType = input.required<'pure-brick' | 'no-resilient-line'>();
  readonly goldfishScore = input<number | undefined>();
}
