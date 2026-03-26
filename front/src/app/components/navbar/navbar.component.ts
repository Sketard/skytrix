import { ChangeDetectionStrategy, Component, computed, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MatButton, MatIconButton } from '@angular/material/button';
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

@Component({
  selector: 'navbar',
  imports: [MatIconModule, RouterLinkActive, RouterLink, MatButton, MatIconButton, A11yModule, MatTooltip, TranslatePipe],
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

  readonly currentLang = signal(this.translate.currentLang || 'fr');

  private readonly allTabs: Tab[] = [
    new Tab('nav.tab.deckBuilder', 'folder', '/decks'),
    new Tab('nav.tab.cardSearch', 'search', '/search'),
    new Tab('nav.tab.pvpArena', 'gamepad', '/pvp'),
    new Tab('nav.tab.replayPvp', 'play_circle', '/pvp/history', 'ADMIN'),
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
        setTimeout(() => this.skipDrawerTransition.set(false), 0);
      });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  toggle(): void {
    this.navbarCollapse.toggle();
  }

  openDrawer(): void {
    this.navbarCollapse.openDrawer();
  }

  closeDrawer(): void {
    this.navbarCollapse.closeDrawer();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.drawerOpen()) {
      this.navbarCollapse.closeDrawer();
    }
  }

  public logout() {
    this.authService.logout();
  }

  setLanguage(lang: string): void {
    this.translate.use(lang);
    this.currentLang.set(lang);
    localStorage.setItem('lang', lang);
  }
}
