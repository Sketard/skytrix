import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MatButton } from '@angular/material/button';

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
  imports: [CommonModule, MatIconModule, RouterLinkActive, RouterLink, MatButton],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavbarComponent {
  public tabs: Array<Tab> = [];

  public user = this.authService.user;

  constructor(private readonly authService: AuthService) {
    this.addTab(new Tab('Construction de deck', 'folder', '/decks'));
    this.addTab(new Tab('Recherche de cartes', 'search', '/search'));
    this.addTab(new Tab('Paramètres', 'settings_suggest', '/parameters'));
  }

  private addTab(tab: Tab) {
    this.tabs.push(tab);
  }

  public logout() {
    this.authService.logout();
  }
}
