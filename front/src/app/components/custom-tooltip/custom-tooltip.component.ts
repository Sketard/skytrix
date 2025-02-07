import { CommonModule } from '@angular/common';
import { Component, TemplateRef, input, model } from '@angular/core';

@Component({
  selector: 'custom-tooltip',
  templateUrl: './custom-tooltip.component.html',
  styleUrls: ['./custom-tooltip.component.scss'],
  imports: [CommonModule],
  standalone: true,
})
export class CustomToolTipComponent {
  readonly text = model<string>('');
  readonly contentTemplate = model.required<TemplateRef<any>>();
}
