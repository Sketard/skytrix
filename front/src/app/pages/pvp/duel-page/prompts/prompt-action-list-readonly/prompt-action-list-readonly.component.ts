import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  OnInit,
} from '@angular/core';
import { PromptSubComponent } from '../prompt.types';
import { HintContext } from '../../../types';
import { SelectIdleCmdMsg, SelectBattleCmdMsg, IdleCmdResponse, BattleCmdResponse } from '../../../duel-ws.types';
import { IDLE_ACTION, BATTLE_ACTION } from '../../idle-action-codes';

type ActionListPrompt = SelectIdleCmdMsg | SelectBattleCmdMsg;

interface ActionSummary {
  label: string;
  cardName: string;
}

@Component({
  selector: 'app-prompt-action-list-readonly',
  templateUrl: './prompt-action-list-readonly.component.html',
  styleUrl: './prompt-action-list-readonly.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptActionListReadonlyComponent implements PromptSubComponent<ActionListPrompt>, OnInit {
  promptData: ActionListPrompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();
  readOnly = true;
  preSelectedResponse: unknown = undefined;

  actionSummary: ActionSummary | null = null;

  ngOnInit(): void {
    if (!this.promptData || this.preSelectedResponse == null) return;

    if (this.promptData.type === 'SELECT_IDLECMD') {
      const r = this.preSelectedResponse as IdleCmdResponse;
      this.actionSummary = this.resolveIdleAction(this.promptData, r);
    } else {
      const r = this.preSelectedResponse as BattleCmdResponse;
      this.actionSummary = this.resolveBattleAction(this.promptData, r);
    }
  }

  private resolveIdleAction(prompt: SelectIdleCmdMsg, r: IdleCmdResponse): ActionSummary {
    switch (r.action) {
      case IDLE_ACTION.SUMMON:
        return { label: 'Normal Summon', cardName: prompt.summons[r.index ?? 0]?.name ?? '' };
      case IDLE_ACTION.SPECIAL_SUMMON:
        return { label: 'Special Summon', cardName: prompt.specialSummons[r.index ?? 0]?.name ?? '' };
      case IDLE_ACTION.REPOSITION:
        return { label: 'Change Position', cardName: prompt.repositions[r.index ?? 0]?.name ?? '' };
      case IDLE_ACTION.SET_MONSTER:
        return { label: 'Set', cardName: prompt.setMonsters[r.index ?? 0]?.name ?? '' };
      case IDLE_ACTION.SET_SPELLTP:
        return { label: 'Set', cardName: prompt.setSpellTraps[r.index ?? 0]?.name ?? '' };
      case IDLE_ACTION.ACTIVATE:
        return { label: 'Activate', cardName: prompt.activations[r.index ?? 0]?.name ?? '' };
      case IDLE_ACTION.BATTLE_PHASE:
        return { label: 'Battle Phase', cardName: '' };
      case IDLE_ACTION.END_TURN:
        return { label: 'End Turn', cardName: '' };
      default:
        return { label: `Action ${r.action}`, cardName: '' };
    }
  }

  private resolveBattleAction(prompt: SelectBattleCmdMsg, r: BattleCmdResponse): ActionSummary {
    switch (r.action) {
      case BATTLE_ACTION.ATTACK:
        return { label: 'Attack', cardName: prompt.attacks[r.index ?? 0]?.name ?? '' };
      case BATTLE_ACTION.ACTIVATE:
        return { label: 'Activate', cardName: prompt.activations[r.index ?? 0]?.name ?? '' };
      case BATTLE_ACTION.MAIN_PHASE_2:
        return { label: 'Main Phase 2', cardName: '' };
      case BATTLE_ACTION.END_TURN:
        return { label: 'End Turn', cardName: '' };
      default:
        return { label: `Action ${r.action}`, cardName: '' };
    }
  }
}
