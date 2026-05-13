import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;
export type DieStyle = 'obsidian' | 'gold';

// Static 2D die face. Pairs with the 3D rolling cube in
// `<app-pvp-dice-arena>` — both share `styles/_die.scss` for face/pip
// geometry + obsidian skin so any tweak applies to both. This component
// is the leaf rendering one face, ready to drop into anywhere a single
// die preview is needed.
@Component({
  selector: 'app-die',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="die-face"
      [class]="styleClass() + ' die-face--' + face()"
      [attr.aria-label]="ariaLabel()"
      role="img">
      @for (i of pipCount(); track i) {
        <span class="die-pip" aria-hidden="true"></span>
      }
    </div>
  `,
  styleUrl: './die.component.scss',
})
export class DieComponent {
  readonly face = input.required<DieFace>();
  readonly dieStyle = input<DieStyle>('obsidian');
  readonly ariaLabel = input<string | undefined>(undefined);

  readonly styleClass = computed(() => `die-style--${this.dieStyle()}`);
  readonly pipCount = computed(() => Array.from({ length: this.face() }, (_, i) => i));
}
