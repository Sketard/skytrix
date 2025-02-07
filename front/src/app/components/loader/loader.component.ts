import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LoaderService } from '../../services/loader.service';

@Component({
  selector: 'app-loader',
  imports: [],
  templateUrl: './loader.component.html',
  styleUrl: './loader.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoaderComponent {
  public loading = this.loaderService.isLoading;

  constructor(private readonly loaderService: LoaderService) {}
}
