import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  input,
  OnInit,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TranslateService } from '@ngx-translate/core';
import { DuelWebSocketService } from '../../duel-web-socket.service';

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
  private readonly wsService = inject(DuelWebSocketService);
  private readonly translate = inject(TranslateService);

  instruction = input<string>('Select a zone');

  ngOnInit(): void {
    this.liveAnnouncer.announce(this.instruction(), 'assertive');
  }

  /**
   * P0-3bis.3 — Right-click anywhere while a SELECT_PLACE / SELECT_DISFIELD
   * zone-highlight is active = roll back to the previous IDLECMD/BATTLECMD.
   *
   * This component is only mounted from `duel-page` (PVP), so no
   * read-only / replay guard is needed — replay uses a separate page
   * component that doesn't render this prompt.
   *
   * `stopPropagation` prevents the dialog's parallel contextmenu listener
   * from also firing if the dialog ever happens to be open simultaneously
   * (defensive — in practice the dialog early-returns when closed).
   */
  @HostListener('document:contextmenu', ['$event'])
  handleContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.wsService.sendCancelPromptSequence();
    this.liveAnnouncer.announce(this.translate.instant('duel.a11y.selectionCancelled'), 'polite');
  }
}
