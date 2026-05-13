import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;
export type DieStyle = 'obsidian' | 'gold';

// Static 2D die face — Phase 1.8 prepares the visual for when the dice
// mechanism lands (Phase 2 server + Phase 3 wiring). The full 3D rolling
// cube (rotation + fall + bounce on the gold-lit table) comes later; this
// component is the leaf rendering one face, ready to drop into the future
// dice-scene container that owns --dice-size / perspective / animation.
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
  styles: [`
    :host {
      // --dice-size is the single sizing knob — inherited from a parent
      // container or set inline. Defaults to 110px (mockup reference) so
      // the component works standalone for previews.
      --dice-size: var(--die-size, 110px);
      display: inline-block;
      width: var(--dice-size);
      height: var(--dice-size);
    }

    .die-face {
      width: var(--dice-size);
      height: var(--dice-size);
      border-radius: calc(var(--dice-size) * 0.127);
      display: grid;
      padding: calc(var(--dice-size) * 0.16);
      gap: calc(var(--dice-size) * 0.055);
    }

    // ===== Obsidian (default) — black/violet face, glowing gold pips =====
    .die-style--obsidian {
      background:
        radial-gradient(circle at 30% 25%, #4a2870 0%, #2a1240 35%, #15071f 100%);
      border: 2px solid #6a3a98;
      box-shadow:
        inset 0 0 24px rgba(168, 100, 220, 0.18),
        inset 0 2px 0 rgba(180, 120, 220, 0.35),
        inset 0 -2px 8px rgba(0, 0, 0, 0.6),
        0 0 0 1px rgba(180, 120, 220, 0.15);

      .die-pip {
        background: radial-gradient(circle at 30% 30%, var(--gold-50, #ffe9a8) 0%, var(--gold, #C9A84C) 60%, var(--gold-900, #8a6a20) 100%);
        box-shadow:
          inset 0 1px 2px rgba(255, 255, 255, 0.4),
          0 0 8px var(--gold-soft-50, rgba(201, 168, 76, 0.7)),
          0 0 16px var(--gold-soft-30, rgba(201, 168, 76, 0.35));
      }
    }

    // Mobile fix — reduce the gold glow so pips don't bleed into each other.
    @media (max-width: 480px) {
      .die-style--obsidian .die-pip {
        box-shadow:
          inset 0 1px 2px rgba(255, 255, 255, 0.45),
          0 0 4px rgba(201, 168, 76, 0.9);
      }
    }

    // ===== Gold variant — gold face, dark engraved pips =====
    .die-style--gold {
      background: radial-gradient(circle at 25% 25%, #fff4d6 0%, #ffe9a8 30%, #C9A84C 100%);
      border: 3px solid #b88828;
      box-shadow:
        inset 0 0 18px rgba(0, 0, 0, 0.15),
        inset 0 2px 0 rgba(255, 255, 255, 0.4),
        0 0 0 1px rgba(255, 255, 255, 0.1);

      .die-pip {
        background: radial-gradient(circle at 30% 30%, #5a3a08, #2a1808);
        box-shadow:
          inset 0 2px 4px rgba(0, 0, 0, 0.5),
          0 1px 1px rgba(255, 255, 255, 0.2);
      }
    }

    // ===== Pip layout per face =====
    .die-face--1 { grid-template: 1fr / 1fr; place-items: center; }
    .die-face--2 { grid-template: 1fr 1fr / 1fr 1fr; }
    .die-face--3 { grid-template: 1fr 1fr 1fr / 1fr 1fr 1fr; }
    .die-face--4 { grid-template: 1fr 1fr / 1fr 1fr; }
    .die-face--5 { grid-template: 1fr 1fr 1fr / 1fr 1fr 1fr; }
    .die-face--6 {
      grid-template: 1fr 1fr 1fr / 1fr 1fr;
      padding: calc(var(--dice-size) * 0.127) calc(var(--dice-size) * 0.20);
      gap: calc(var(--dice-size) * 0.036);
    }

    .die-pip {
      width: calc(var(--dice-size) * 0.127);
      height: calc(var(--dice-size) * 0.127);
      border-radius: 50%;
      align-self: center;
      justify-self: center;
    }

    .die-face--2 .die-pip:nth-child(1) { grid-area: 1 / 1; }
    .die-face--2 .die-pip:nth-child(2) { grid-area: 2 / 2; }

    .die-face--3 .die-pip:nth-child(1) { grid-area: 1 / 1; }
    .die-face--3 .die-pip:nth-child(2) { grid-area: 2 / 2; }
    .die-face--3 .die-pip:nth-child(3) { grid-area: 3 / 3; }

    .die-face--4 .die-pip:nth-child(1) { grid-area: 1 / 1; }
    .die-face--4 .die-pip:nth-child(2) { grid-area: 1 / 2; }
    .die-face--4 .die-pip:nth-child(3) { grid-area: 2 / 1; }
    .die-face--4 .die-pip:nth-child(4) { grid-area: 2 / 2; }

    .die-face--5 .die-pip:nth-child(1) { grid-area: 1 / 1; }
    .die-face--5 .die-pip:nth-child(2) { grid-area: 1 / 3; }
    .die-face--5 .die-pip:nth-child(3) { grid-area: 2 / 2; }
    .die-face--5 .die-pip:nth-child(4) { grid-area: 3 / 1; }
    .die-face--5 .die-pip:nth-child(5) { grid-area: 3 / 3; }

    .die-face--6 .die-pip:nth-child(odd)  { grid-column: 1; }
    .die-face--6 .die-pip:nth-child(even) { grid-column: 2; }
  `],
})
export class DieComponent {
  readonly face = input.required<DieFace>();
  readonly dieStyle = input<DieStyle>('obsidian');
  readonly ariaLabel = input<string | undefined>(undefined);

  readonly styleClass = computed(() => `die-style--${this.dieStyle()}`);
  readonly pipCount = computed(() => Array.from({ length: this.face() }, (_, i) => i));
}
