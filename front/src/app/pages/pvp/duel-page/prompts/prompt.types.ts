import { EventEmitter, Type } from '@angular/core';
import { Prompt } from '../../types/prompt.types';
import { HintContext } from '../../types/hint-context.types';

export type PreferredHeight = 'compact' | 'full' | number;

/**
 * Contract for prompt sub-components instantiated via ComponentPortal.
 *
 * `response` uses Angular's EventEmitter (not rxjs Subject) because the host
 * subscribes to it as an Output-like property on the dynamically created
 * component instance. This is the standard Angular pattern for portal-based
 * dynamic component communication.
 */
export interface PromptSubComponent<T extends Prompt = Prompt> {
  preferredHeight: PreferredHeight;
  promptData: T | null;
  hintContext: HintContext | null;
  response: EventEmitter<unknown>;
}

// Prompt types explicitly ignored by the sheet (Story 1.7 scope)
export const IGNORED_PROMPT_TYPES = new Set(['SELECT_IDLECMD', 'SELECT_BATTLECMD']);

// Auto-select fallback types (PvP-A0: respond automatically with first valid option)
export const AUTO_SELECT_PROMPT_TYPES = new Set(['SORT_CARD', 'SORT_CHAIN', 'ANNOUNCE_CARD']);

// Populated as each sub-component is created (Tasks 4–9).
// Keyed by ServerMessage 'type' discriminant.
export const PROMPT_COMPONENT_MAP: Record<string, Type<PromptSubComponent>> = {};
