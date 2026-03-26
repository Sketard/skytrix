import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { LiveAnnouncer } from '@angular/cdk/a11y';

@Component({
  selector: 'app-prompt-zone-highlight',
  templateUrl: './prompt-zone-highlight.component.html',
  styleUrl: './prompt-zone-highlight.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('150ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0 })),
      ]),
    ]),
  ],
})
export class PromptZoneHighlightComponent implements OnInit {
  private readonly liveAnnouncer = inject(LiveAnnouncer);

  instruction = input<string>('Select a zone');
  /** In replay read-only mode, highlights the zone that was selected. */
  selectedZone = input<string | null>(null);

  ngOnInit(): void {
    this.liveAnnouncer.announce(this.instruction(), 'assertive');
  }
}
