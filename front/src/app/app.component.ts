import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { NavbarComponent } from './components/navbar/navbar.component';
import { LoaderComponent } from './components/loader/loader.component';
import { AuthService } from './services/auth.service';
import { CURRENT_USER_KEY } from './core/utilities/auth.constants';
import { NavbarCollapseService } from './services/navbar-collapse.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavbarComponent, LoaderComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  title = 'skytrix';

  private readonly navbarCollapse = inject(NavbarCollapseService);
  readonly isMobile = this.navbarCollapse.isMobile;
  readonly connectedUser = this.authService.user;

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {
    const connectedUser = JSON.parse(localStorage.getItem(CURRENT_USER_KEY)!);
    if (connectedUser) {
      authService.setUser(JSON.parse(localStorage.getItem(CURRENT_USER_KEY)!));
    }
  }
}
