import { isDevMode } from '@angular/core';
import { SimCommand } from '../simulator.models';

export class CompositeCommand implements SimCommand {
  constructor(private readonly commands: SimCommand[]) {}

  execute(): void {
    this.commands.forEach(cmd => cmd.execute());
  }

  undo(): void {
    // Reverse order for correct undo semantics
    // Each sub-command is guarded so a failure mid-sequence
    // does not prevent remaining sub-commands from undoing
    const reversed = [...this.commands].reverse();
    for (const cmd of reversed) {
      try {
        cmd.undo();
      } catch (e) {
        if (isDevMode()) {
          console.warn('CompositeCommand: sub-command undo failed, continuing…', e);
        }
      }
    }
  }
}
