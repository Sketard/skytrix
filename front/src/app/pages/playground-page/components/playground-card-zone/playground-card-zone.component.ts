import {ChangeDetectionStrategy, Component} from '@angular/core';
import {PlaygroundCardRowComponent} from "./components/playground-card-row/playground-card-row.component";
import {PlaygroundZone} from "../../../../core/enums/playground-zone.enum";

@Component({
  selector: 'playground-card-zone',
  imports: [
    PlaygroundCardRowComponent
  ],
  templateUrl: './playground-card-zone.component.html',
  styleUrl: './playground-card-zone.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlaygroundCardZoneComponent {
  public zone = PlaygroundZone;
}
