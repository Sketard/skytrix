import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MatButton, MatIconButton } from '@angular/material/button';
import { NavbarCollapseService } from '../../services/navbar-collapse.service';
import { A11yModule } from '@angular/cdk/a11y';
import { filter } from 'rxjs';

class Tab {
  name: string;
  icon: string;
  path: string;

  constructor(name: string, icon: string, path: string) {
    this.name = name;
    this.icon = icon;
    this.path = path;
  }
}

@Component({
  selector: 'navbar',
  imports: [MatIconModule, RouterLinkActive, RouterLink, MatButton, MatIconButton, A11yModule],
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

  public tabs: Array<Tab> = [];
  public user = this.authService.user;
  readonly collapsed = this.navbarCollapse.collapsed;
  readonly isMobile = this.navbarCollapse.isMobile;
  readonly drawerOpen = this.navbarCollapse.drawerOpen;
  readonly shouldHideTopBar = this.navbarCollapse.shouldHideTopBar;
  readonly skipDrawerTransition = signal(false);

  constructor() {
    this.addTab(new Tab('Construction de deck', 'folder', '/decks'));
    this.addTab(new Tab('Recherche de cartes', 'search', '/search'));
    this.addTab(new Tab('Paramètres', 'settings_suggest', '/parameters'));

    const sub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => {
        this.skipDrawerTransition.set(true);
        this.navbarCollapse.closeDrawer();
        setTimeout(() => this.skipDrawerTransition.set(false), 0);
      });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  private addTab(tab: Tab) {
    this.tabs.push(tab);
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
}
