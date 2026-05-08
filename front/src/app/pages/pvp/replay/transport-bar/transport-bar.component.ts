import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-transport-bar',
  templateUrl: './transport-bar.component.html',
  styleUrl: './transport-bar.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconButton, MatIcon, MatProgressSpinner, MatTooltip, TranslateModule],
})
export class TransportBarComponent {
  readonly isPlaying = input(false);
  readonly atEnd = input(false);
  readonly forking = input(false);
  readonly positionLabel = input<string | null>(null);
  readonly animationsEnabled = input(false);
  readonly promptMode = input<'result' | 'decision'>('result');
  readonly perspectiveIndex = input(0);

  readonly skipStart = output<void>();
  readonly stepBack = output<void>();
  readonly playPause = output<void>();
  readonly stepForward = output<void>();
  readonly skipEnd = output<void>();
  readonly fork = output<void>();
  readonly toggleAnimations = output<void>();
  readonly togglePromptMode = output<void>();
  readonly togglePerspective = output<void>();
}
