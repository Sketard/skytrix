import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { NgForOf } from '@angular/common';

export type ActionButton = {
  label: string;
  callback: () => void;
};

@Component({
  selector: 'app-multiple-action-button',
  imports: [MatIconButton, MatIcon, MatMenuTrigger, MatMenu, MatMenuItem, NgForOf],
  templateUrl: './multiple-action-button.component.html',
  styleUrl: './multiple-action-button.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultipleActionButtonComponent {
  readonly icon = input<string>('');
  readonly buttons = input<Array<ActionButton>>([]);
}
