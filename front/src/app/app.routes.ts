import { Routes } from '@angular/router';
import { CardSearchPageComponent } from './pages/card-search-page/card-search-page.component';
import { DeckPageComponent } from './pages/deck-page/deck-page.component';
import { DeckBuilderComponent } from './pages/deck-page/components/deck-builder/deck-builder.component';
import { ParameterPageComponent } from './pages/parameter-page/parameter-page.component';
import { AuthService } from './services/auth.service';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { SimulatorPageComponent } from './pages/simulator/simulator-page.component';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', component: LoginPageComponent },
  { path: 'decks', component: DeckPageComponent, canActivate: [AuthService] },
  { path: 'decks/builder', component: DeckBuilderComponent, canActivate: [AuthService] },
  { path: 'decks/:id/simulator', component: SimulatorPageComponent, canActivate: [AuthService] },
  { path: 'decks/:id', component: DeckBuilderComponent, canActivate: [AuthService] },
  { path: 'search', component: CardSearchPageComponent, canActivate: [AuthService] },
  { path: 'parameters', component: ParameterPageComponent, canActivate: [AuthService] },
];
