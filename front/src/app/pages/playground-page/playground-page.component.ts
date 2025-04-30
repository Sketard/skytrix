import {ChangeDetectionStrategy, Component} from '@angular/core';
import {PlaygroundService} from '../../services/playground.service';
import {DeckBuildService} from "../../services/deck-build.service";
import {PlaygroundCardZoneComponent} from "./components/playground-card-zone/playground-card-zone.component";
import {CardComponent} from "../../components/card/card.component";
import {CdkDrag, CdkDropList, CdkDropListGroup} from "@angular/cdk/drag-drop";
import {CardDisplayType} from "../../core/enums/card-display-type";

@Component({
  selector: 'app-playground-page',
  imports: [
    PlaygroundCardZoneComponent,
    CardComponent,
    CdkDrag,
    CdkDropList,
    CdkDropListGroup
  ],
  templateUrl: './playground-page.component.html',
  styleUrl: './playground-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlaygroundPageComponent {
  public displayMode = CardDisplayType.MOSAIC

  constructor(public readonly playGroundService: PlaygroundService, private readonly deckBuilderService: DeckBuildService) {
    this.deckBuilderService.getById(1).subscribe(deck => this.playGroundService.setDeck(deck));
  }
}

