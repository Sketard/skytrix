import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DUEL_THEMES, DuelTheme, DuelThemeService } from '../pvp/duel-page/duel-theme.service';
import { ReducedMotionService } from '../../services/reduced-motion.service';
import { APP_THEME_MODES, AppThemeMode, AppThemeService } from '../../services/app-theme.service';
import { RadioCardGroupComponent } from '../../components/radio-card-group/radio-card-group.component';
import { RadioCardComponent } from '../../components/radio-card/radio-card.component';
import { ToggleSwitchComponent } from '../../components/toggle-switch/toggle-switch.component';

type Lang = 'fr' | 'en';

const LANGS: ReadonlyArray<{ code: Lang; labelKey: string }> = [
  { code: 'fr', labelKey: 'preferences.language.fr' },
  { code: 'en', labelKey: 'preferences.language.en' },
];

@Component({
  selector: 'app-preferences-page',
  imports: [MatIconModule, TranslatePipe, RadioCardGroupComponent, RadioCardComponent, ToggleSwitchComponent],
  templateUrl: './preferences-page.component.html',
  styleUrl: './preferences-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferencesPageComponent {
  protected readonly appThemeModes = APP_THEME_MODES;
  protected readonly themes = DUEL_THEMES;
  protected readonly langs = LANGS;

  protected readonly appThemeService = inject(AppThemeService);
  protected readonly themeService = inject(DuelThemeService);
  protected readonly motionService = inject(ReducedMotionService);
  private readonly translate = inject(TranslateService);

  protected readonly currentLang = signal<Lang>(
    (this.translate.currentLang as Lang) ?? 'fr',
  );

  protected setAppTheme(mode: AppThemeMode): void {
    this.appThemeService.setMode(mode);
  }

  protected setTheme(theme: DuelTheme): void {
    this.themeService.setTheme(theme);
  }

  protected setLang(lang: Lang): void {
    this.translate.use(lang);
    this.currentLang.set(lang);
    try {
      localStorage.setItem('lang', lang);
    } catch {
      // ignore — runtime state only.
    }
  }

  protected toggleReducedMotion(): void {
    this.motionService.toggle();
  }
}
