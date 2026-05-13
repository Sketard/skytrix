import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// Stable hue derived from a string — used to color user avatars by pseudo so
// the same pseudo always gets the same gradient across the app. djb2 hash so
// collisions are minimal in practice; the modulo distributes evenly across
// the 360° hue wheel.
function hueFromString(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) + input.charCodeAt(i);
  }
  return Math.abs(h) % 360;
}

@Component({
  selector: 'app-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="avatar"
      [class]="sizeClass()"
      [style.background]="background()"
      [style.border-color]="borderColor()"
      [attr.aria-label]="ariaLabel() ?? pseudo()"
      role="img">
      {{ initial() }}
    </span>
  `,
  styles: [`
    :host { display: inline-block; }

    .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--avatar-size, 44px);
      height: var(--avatar-size, 44px);
      border-radius: 50%;
      border: 2px solid var(--avatar-border, transparent);
      font: var(--weight-bold, 700) var(--avatar-font-size, 1.1rem) / 1 'Rajdhani', sans-serif;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
      flex-shrink: 0;
      user-select: none;
      box-shadow: var(--elevation-1, 0 2px 8px rgba(0, 0, 0, 0.25));
    }

    .avatar--sm { --avatar-size: 32px; --avatar-font-size: 0.85rem; }
    .avatar--md { --avatar-size: 44px; --avatar-font-size: 1.1rem; }
    .avatar--lg { --avatar-size: 64px; --avatar-font-size: 1.5rem; }
    .avatar--xl { --avatar-size: 76px; --avatar-font-size: 1.85rem; }
  `],
})
export class AvatarComponent {
  readonly pseudo = input.required<string>();
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  readonly ariaLabel = input<string | undefined>(undefined);

  readonly initial = computed(() => {
    const p = this.pseudo().trim();
    return p.length > 0 ? p[0].toUpperCase() : '?';
  });

  private readonly hue = computed(() => hueFromString(this.pseudo()));

  readonly background = computed(() => {
    const h = this.hue();
    return `linear-gradient(135deg, hsl(${h}, 65%, 45%), hsl(${(h + 30) % 360}, 70%, 30%))`;
  });

  readonly borderColor = computed(() => `hsl(${this.hue()}, 60%, 55%)`);

  readonly sizeClass = computed(() => `avatar--${this.size()}`);
}
