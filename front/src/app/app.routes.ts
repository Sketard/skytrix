import { Routes } from '@angular/router';
import { CardSearchPageComponent } from './pages/card-search-page/card-search-page.component';
import { DeckPageComponent } from './pages/deck-page/deck-page.component';
import { DeckBuilderComponent } from './pages/deck-page/components/deck-builder/deck-builder.component';
import { ParameterPageComponent } from './pages/parameter-page/parameter-page.component';
import { AuthService } from './services/auth.service';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { SimulatorPageComponent } from './pages/simulator/simulator-page.component';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', component: LoginPageComponent },
  { path: 'decks', component: DeckPageComponent, canActivate: [AuthService] },
  { path: 'decks/builder', component: DeckBuilderComponent, canActivate: [AuthService], canDeactivate: [unsavedChangesGuard] },
  { path: 'decks/:id/simulator', component: SimulatorPageComponent, canActivate: [AuthService] },
  { path: 'decks/:id', component: DeckBuilderComponent, canActivate: [AuthService], canDeactivate: [unsavedChangesGuard] },
  { path: 'search', component: CardSearchPageComponent, canActivate: [AuthService] },
  { path: 'parameters', component: ParameterPageComponent, canActivate: [AuthService] },
  {
    path: 'pvp',
    loadComponent: () => import('./pages/pvp/lobby-page/lobby-page.component').then(m => m.LobbyPageComponent),
    canActivate: [AuthService],
  },
  {
    path: 'pvp/duel/:roomCode',
    loadComponent: () => import('./pages/pvp/duel-page/duel-page.component').then(m => m.DuelPageComponent),
    canActivate: [AuthService],
    canDeactivate: [(component: import('./pages/pvp/duel-page/duel-page.component').DuelPageComponent) => {
      if (component.roomState() !== 'active') return true;
      if (component.wsService.duelResult()) return true;
      if (component.connectionStatus() === 'lost') return true;
      return component.confirmSurrender();
    }],
  },
];
