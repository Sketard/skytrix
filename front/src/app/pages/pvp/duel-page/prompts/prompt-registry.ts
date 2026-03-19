import { Type } from '@angular/core';
import { PROMPT_COMPONENT_MAP, PromptSubComponent } from './prompt.types';
import { PromptYesNoComponent } from './prompt-yes-no/prompt-yes-no.component';
import { PromptCardGridComponent } from './prompt-card-grid/prompt-card-grid.component';
import { PromptOptionListComponent } from './prompt-option-list/prompt-option-list.component';
import { PromptPositionSelectComponent } from './prompt-position-select/prompt-position-select.component';
import { PromptNumericInputComponent } from './prompt-numeric-input/prompt-numeric-input.component';
import { PromptChoiceComponent } from './prompt-choice/prompt-choice.component';
import { PromptSortCardComponent } from './prompt-sort-card/prompt-sort-card.component';
import { PromptAnnounceCardComponent } from './prompt-announce-card/prompt-announce-card.component';
// PromptZoneHighlightComponent uses Pattern A (no sheet) — not registered in map

const REGISTRY: [string, Type<PromptSubComponent>][] = [
  ['SELECT_YESNO', PromptYesNoComponent],
  ['SELECT_EFFECTYN', PromptYesNoComponent],
  ['SELECT_CARD', PromptCardGridComponent],
  ['SELECT_CHAIN', PromptCardGridComponent],
  ['SELECT_TRIBUTE', PromptCardGridComponent],
  ['SELECT_SUM', PromptCardGridComponent],
  ['SELECT_UNSELECT_CARD', PromptCardGridComponent],
  ['SELECT_POSITION', PromptPositionSelectComponent],
  ['SELECT_OPTION', PromptOptionListComponent],
  ['ANNOUNCE_RACE', PromptOptionListComponent],
  ['ANNOUNCE_ATTRIB', PromptOptionListComponent],
  ['ANNOUNCE_NUMBER', PromptNumericInputComponent],
  ['SELECT_COUNTER', PromptNumericInputComponent],
  ['RPS_CHOICE', PromptChoiceComponent],
  ['SELECT_TP', PromptChoiceComponent],
  ['SORT_CARD', PromptSortCardComponent],
  ['SORT_CHAIN', PromptSortCardComponent],
  ['ANNOUNCE_CARD', PromptAnnounceCardComponent],
];

for (const [type, component] of REGISTRY) {
  PROMPT_COMPONENT_MAP[type] = component;
}
