import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { NavbarComponent } from './components/navbar/navbar.component';
import { LoaderComponent } from './components/loader/loader.component';
import { CardTooltipComponent } from './components/card-tooltip/card-tooltip.component';
import { AuthService } from './services/auth.service';
import { CURRENT_USER_KEY } from './core/utilities/auth.constants';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavbarComponent, LoaderComponent, CardTooltipComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  title = 'skytrix';

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
