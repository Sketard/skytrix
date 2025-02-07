import { Directive, ElementRef, Input, OnInit } from '@angular/core';

@Directive({
  selector: '[imgLoader]',
})
export class ImgLoaderDirective implements OnInit {
  @Input() imgLoader: string = '';

  constructor(private readonly imageRef: ElementRef) {}

  private readonly defaultImageSrc: string = 'assets/images/card_back.jpg';

  ngOnInit() {
    this.imageRef.nativeElement.setAttribute('src', this.defaultImageSrc);

    const downloadingImage = new Image();
    downloadingImage.onload = () => {
      this.imageRef.nativeElement.setAttribute('src', this.imgLoader);
    };
    downloadingImage.src = this.imgLoader;
  }
}
