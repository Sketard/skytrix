import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MatButton } from '@angular/material/button';
import { NavbarCollapseService } from '../../services/navbar-collapse.service';

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
  imports: [MatIconModule, RouterLinkActive, RouterLink, MatButton],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavbarComponent {
  private readonly navbarCollapse = inject(NavbarCollapseService);
  private readonly authService = inject(AuthService);

  public tabs: Array<Tab> = [];
  public user = this.authService.user;
  readonly collapsed = this.navbarCollapse.collapsed;

  constructor() {
    this.addTab(new Tab('Construction de deck', 'folder', '/decks'));
    this.addTab(new Tab('Recherche de cartes', 'search', '/search'));
    this.addTab(new Tab('Paramètres', 'settings_suggest', '/parameters'));
  }

  private addTab(tab: Tab) {
    this.tabs.push(tab);
  }

  toggle(): void {
    this.navbarCollapse.toggle();
  }

  public logout() {
    this.authService.logout();
  }
}
