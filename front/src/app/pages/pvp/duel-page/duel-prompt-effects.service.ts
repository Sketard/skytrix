import { DestroyRef, effect, Injectable, inject, Signal, untracked } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { DuelWebSocketService } from './duel-web-socket.service';
import { InactivityWarningDialogComponent } from './inactivity-warning-dialog.component';
import type { SelectChainMsg } from '../duel-ws.types';
import type { ActivationMode } from './pvp-activation-toggle/pvp-activation-toggle.component';

@Injectable()
export class DuelPromptEffectsService {

  private readonly wsService = inject(DuelWebSocketService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  private inactivityDialogRef: MatDialogRef<unknown> | null = null;

  initEffects(config: { activationMode: Signal<ActivationMode> }): void {
    // [H4 fix] Activation toggle auto-respond effect (off + auto modes)
    effect(() => {
      const mode = config.activationMode();
      const prompt = this.wsService.pendingPrompt();
      if (!prompt || mode === 'on') return;

      untracked(() => {
        // After a STATE_SYNC (reconnect), suppress auto-respond until the game resumes
        if (this.wsService.justReconnected()) return;

        const isOptionalEffectYn = prompt.type === 'SELECT_EFFECTYN';
        const isOptionalChain = prompt.type === 'SELECT_CHAIN' && !(prompt as SelectChainMsg).forced;
        if (!isOptionalEffectYn && !isOptionalChain) return;

        let shouldAutoRespond = false;

        if (mode === 'off') {
          shouldAutoRespond = true;
        } else if (mode === 'auto') {
          const hint = this.wsService.hintContext();
          shouldAutoRespond = hint.hintType === 0;
        }

        if (!shouldAutoRespond) return;

        if (isOptionalEffectYn) {
          this.wsService.sendResponse('SELECT_EFFECTYN', { yes: false });
        } else if (isOptionalChain) {
          this.wsService.sendResponse('SELECT_CHAIN', { index: null });
        }
      });
    });

    // Inactivity warning — open/close dialog on INACTIVITY_WARNING signal
    effect(() => {
      const warning = this.wsService.inactivityWarning();
      untracked(() => {
        if (warning && !this.inactivityDialogRef) {
          this.inactivityDialogRef = this.dialog.open(InactivityWarningDialogComponent, {
            disableClose: true,
            width: '320px',
            panelClass: ['pvp-dialog-panel', 'pvp-dialog-panel--warning'],
          });
          this.inactivityDialogRef.afterClosed().subscribe(() => {
            if (this.inactivityDialogRef) {
              this.inactivityDialogRef = null;
              this.wsService.sendActivityPing();
            }
          });
        } else if (!warning && this.inactivityDialogRef) {
          this.inactivityDialogRef.close();
          this.inactivityDialogRef = null;
        }
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.inactivityDialogRef) {
        this.inactivityDialogRef.close();
        this.inactivityDialogRef = null;
      }
    });
  }
}
