import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ParameterService } from '../../services/parameter.service';
import { MatButton } from '@angular/material/button';
import { displayErrorToastr, displaySuccessToastr } from '../../core/utilities/functions';
import { ToastrService } from 'ngx-toastr';

@Component({
  selector: 'app-parameter-page',
  imports: [MatButton],
  templateUrl: './parameter-page.component.html',
  styleUrl: './parameter-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParameterPageComponent {
  constructor(
    private readonly supportService: ParameterService,
    private readonly toastrService: ToastrService
  ) {}

  public fetchDatabaseCards() {
    this.supportService.fetchDatabaseCards().subscribe({
      next: () => displaySuccessToastr(this.toastrService, 'Cartes mises à jour avec succès'),
      error: error => displayErrorToastr(this.toastrService, error),
    });
  }

  public fetchDatabaseImages() {
    this.supportService.fetchDatabaseImages().subscribe({
      next: () =>
        displaySuccessToastr(
          this.toastrService,
          'La récupération des images a démarré avec succès. Seulement peut prendre quelques temps.'
        ),
      error: error => displayErrorToastr(this.toastrService, error),
    });
  }

  public fetchDatabaseTcgImages() {
    this.supportService.fetchDatabaseTcgImages().subscribe({
      next: () =>
        displaySuccessToastr(
          this.toastrService,
          'La récupération des images traduites a démarré avec succès. Seulement peut prendre quelques temps.'
        ),
      error: error => displayErrorToastr(this.toastrService, error),
    });
  }

  public fetchDatabaseBanlist() {
    this.supportService.fetchDatabaseBanlist().subscribe({
      next: () => displaySuccessToastr(this.toastrService, 'Banlist mises à jour avec succès'),
      error: error => displayErrorToastr(this.toastrService, error),
    });
  }
}
