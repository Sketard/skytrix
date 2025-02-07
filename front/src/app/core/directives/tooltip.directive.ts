import { Overlay, OverlayPositionBuilder, OverlayRef } from '@angular/cdk/overlay';
import { Directive, ElementRef, HostListener, input, OnInit } from '@angular/core';
import { CardDetail } from '../model/card-detail';
import { TooltipService } from '../../services/tooltip.service';

@Directive({
  selector: '[customToolTip]',
  standalone: true,
})
export class ToolTipRendererDirective implements OnInit {
  readonly showToolTip = input<boolean>(true);
  readonly customToolTip = input<CardDetail>(new CardDetail());
  readonly keepPropagation = input<boolean>(false);
  readonly offsetY = input<number>(0);

  private _overlayRef: OverlayRef | undefined;
  private timeoutId: any;

  constructor(
    private readonly _overlay: Overlay,
    private readonly _overlayPositionBuilder: OverlayPositionBuilder,
    private readonly _elementRef: ElementRef,
    private readonly tooltipService: TooltipService
  ) {}

  ngOnInit() {
    if (!this.showToolTip()) {
      return;
    }

    const positionStrategy = this._overlayPositionBuilder.global().centerHorizontally().centerVertically();

    this._overlayRef = this._overlay.create({ positionStrategy });

    document.addEventListener(
      'DOMMouseScroll',
      function (e) {
        e.stopPropagation();
        return false;
      },
      false
    );
  }

  @HostListener('click', ['$event']) onClick($event: any) {
    if (this.timeoutId) {
      this.clearTimeOut();
    } else {
      this.timeoutId = setTimeout(() => {
        if (this._overlayRef && !this._overlayRef.hasAttached()) {
          this.tooltipService.setCardDetail(this.customToolTip());
          window.addEventListener('click', this.handleClickOutside);
        }
        if ($event && !this.keepPropagation()) {
          $event.stopPropagation();
        }
        this.clearTimeOut();
      }, 150);
    }
  }

  private readonly handleClickOutside = ($event: MouseEvent): any => {
    if (!this.isCursorOnElement($event, document.querySelector('.dark-theme-tooltip')!)) {
      this.closeToolTip();
    }
  };

  private isCursorOnElement(event: MouseEvent, element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    return mouseX >= rect.left && mouseX <= rect.right && mouseY >= rect.top && mouseY <= rect.bottom;
  }

  private closeToolTip() {
    this.clearTimeOut();
    this._overlayRef!.detach();
    this.tooltipService.setCardDetail(undefined);
    window.removeEventListener('click', this.handleClickOutside);
  }

  private clearTimeOut() {
    clearTimeout(this.timeoutId);
    this.timeoutId = undefined;
  }
}
