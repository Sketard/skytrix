import { ChangeDetectionStrategy, Component, computed, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NavbarCollapseService } from '../../services/navbar-collapse.service';
import { A11yModule } from '@angular/cdk/a11y';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs';

import { Role } from '../../core/model/account/user';

class Tab {
  name: string;
  icon: string;
  path: string;
  requiredRole?: Role;

  constructor(name: string, icon: string, path: string, requiredRole?: Role) {
    this.name = name;
    this.icon = icon;
    this.path = path;
    this.requiredRole = requiredRole;
  }
}

interface LangOption {
  code: 'fr' | 'en';
  labelKey: string; // i18n key for the lang name in its own language
  flagAsset: string;
}

const LANG_OPTIONS: readonly LangOption[] = [
  { code: 'fr', labelKey: 'nav.lang.fr', flagAsset: 'assets/images/icons/flag-fr.svg' },
  { code: 'en', labelKey: 'nav.lang.en', flagAsset: 'assets/images/icons/flag-en.svg' },
];

@Component({
  selector: 'navbar',
  imports: [MatIconModule, RouterLinkActive, RouterLink, A11yModule, MatTooltip, TranslatePipe],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavbarComponent {
  private readonly navbarCollapse = inject(NavbarCollapseService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);

  readonly langOptions = LANG_OPTIONS;
  readonly currentLang = signal<'fr' | 'en'>(this.normalizeLang(this.translate.currentLang));
  readonly currentLangOption = computed(() =>
    this.langOptions.find(o => o.code === this.currentLang()) ?? this.langOptions[0]
  );
  readonly langOpen = signal(false);

  private readonly allTabs: Tab[] = [
    new Tab('nav.tab.deckBuilder', 'folder', '/decks'),
    new Tab('nav.tab.cardSearch', 'search', '/search'),
    new Tab('nav.tab.pvpArena', 'gamepad', '/pvp'),
    new Tab('nav.tab.replayPvp', 'play_circle', '/pvp/history'),
    new Tab('nav.tab.settings', 'settings_suggest', '/parameters', 'ADMIN'),
  ];

  public user = this.authService.user;
  public tabs = computed(() => {
    const role = this.user()?.role;
    return this.allTabs.filter(tab => !tab.requiredRole || tab.requiredRole === role);
  });
  readonly collapsed = this.navbarCollapse.collapsed;
  readonly isMobile = this.navbarCollapse.isMobile;
  readonly drawerOpen = this.navbarCollapse.drawerOpen;
  readonly shouldHideTopBar = this.navbarCollapse.shouldHideTopBar;
  readonly skipDrawerTransition = signal(false);

  constructor() {
    const sub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => {
        this.skipDrawerTransition.set(true);
        this.navbarCollapse.closeDrawer();
        this.langOpen.set(false);
        setTimeout(() => this.skipDrawerTransition.set(false), 0);
      });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  toggle(): void {
    this.navbarCollapse.toggle();
    // Collapsing the sidebar should close any open dropdown.
    if (this.collapsed()) this.langOpen.set(false);
  }

  openDrawer(): void {
    this.navbarCollapse.openDrawer();
  }

  closeDrawer(): void {
    this.navbarCollapse.closeDrawer();
    this.langOpen.set(false);
  }

  toggleLang(): void {
    this.langOpen.update(v => !v);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.langOpen()) return;
    const target = event.target as HTMLElement;
    if (target.closest('.lang-switcher')) return;
    this.langOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.langOpen()) {
      this.langOpen.set(false);
      return;
    }
    if (this.drawerOpen()) {
      this.navbarCollapse.closeDrawer();
    }
  }

  public logout() {
    this.authService.logout();
  }

  setLanguage(lang: 'fr' | 'en'): void {
    this.translate.use(lang);
    this.currentLang.set(lang);
    this.langOpen.set(false);
    localStorage.setItem('lang', lang);
  }

  private normalizeLang(raw: string | undefined): 'fr' | 'en' {
    return raw === 'en' ? 'en' : 'fr';
  }
}
