import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ParameterService } from '../../services/parameter.service';
import { MatButton } from '@angular/material/button';
import { displayError, displaySuccess } from '../../core/utilities/functions';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCard } from '@angular/material/card';
import { MatDivider } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-parameter-page',
  imports: [MatButton, MatCard, MatDivider, MatIconModule, MatProgressSpinner],
  templateUrl: './parameter-page.component.html',
  styleUrl: './parameter-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParameterPageComponent {
  readonly loading = signal({ cards: false, images: false, tcgImages: false, banlist: false });

  constructor(
    private readonly supportService: ParameterService,
    private readonly snackBar: MatSnackBar
  ) {}

  lastSync(key: string): string {
    const raw = localStorage.getItem(`sync_${key}_lastDate`);
    if (!raw) return 'Jamais synchronisé';
    const date = new Date(raw);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'il y a quelques secondes';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `il y a ${diffMin} minute${diffMin > 1 ? 's' : ''}`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `il y a ${diffH} heure${diffH > 1 ? 's' : ''}`;
    const diffD = Math.floor(diffH / 24);
    return `il y a ${diffD} jour${diffD > 1 ? 's' : ''}`;
  }

  private setLoading(key: 'cards' | 'images' | 'tcgImages' | 'banlist', value: boolean): void {
    this.loading.update(l => ({ ...l, [key]: value }));
  }

  private onSuccess(key: string, message: string): void {
    localStorage.setItem(`sync_${key}_lastDate`, new Date().toISOString());
    this.setLoading(key as any, false);
    displaySuccess(this.snackBar, message);
  }

  private onError(key: 'cards' | 'images' | 'tcgImages' | 'banlist', error: any): void {
    this.setLoading(key, false);
    displayError(this.snackBar, error);
  }

  public fetchDatabaseCards() {
    this.setLoading('cards', true);
    this.supportService.fetchDatabaseCards().subscribe({
      next: () => this.onSuccess('cards', 'Cartes mises à jour avec succès'),
      error: error => this.onError('cards', error),
    });
  }

  public fetchDatabaseImages() {
    this.setLoading('images', true);
    this.supportService.fetchDatabaseImages().subscribe({
      next: () => this.onSuccess('images', 'La récupération des images a démarré avec succès'),
      error: error => this.onError('images', error),
    });
  }

  public fetchDatabaseTcgImages() {
    this.setLoading('tcgImages', true);
    this.supportService.fetchDatabaseTcgImages().subscribe({
      next: () => this.onSuccess('tcgImages', 'La récupération des images traduites a démarré avec succès'),
      error: error => this.onError('tcgImages', error),
    });
  }

  public fetchDatabaseBanlist() {
    this.setLoading('banlist', true);
    this.supportService.fetchDatabaseBanlist().subscribe({
      next: () => this.onSuccess('banlist', 'Banlist mises à jour avec succès'),
      error: error => this.onError('banlist', error),
    });
  }
}
