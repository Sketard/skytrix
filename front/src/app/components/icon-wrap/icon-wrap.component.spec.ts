import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconWrapComponent, IconWrapPalette } from './icon-wrap.component';

@Component({
  standalone: true,
  imports: [IconWrapComponent],
  template: `<app-icon-wrap [icon]="icon" [palette]="palette"></app-icon-wrap>`,
})
class HostComponent {
  icon = 'folder_special';
  palette: IconWrapPalette = 'gold';
}

describe('IconWrapComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function root(): HTMLElement {
    return fixture.nativeElement.querySelector('app-icon-wrap');
  }

  it('renders the icon and is aria-hidden', () => {
    fixture.detectChanges();
    expect(root().getAttribute('aria-hidden')).toBe('true');
    expect(root().querySelector('.icon-wrap__icon')?.textContent?.trim()).toBe('folder_special');
  });

  it('defaults to gold palette', () => {
    fixture.detectChanges();
    expect(root().classList.contains('icon-wrap--gold')).toBeTrue();
    expect(root().classList.contains('icon-wrap--cyan')).toBeFalse();
  });

  it('applies cyan palette class', () => {
    host.palette = 'cyan';
    fixture.detectChanges();
    expect(root().classList.contains('icon-wrap--cyan')).toBeTrue();
    expect(root().classList.contains('icon-wrap--gold')).toBeFalse();
  });

  it('updates the icon when input changes', () => {
    fixture.detectChanges();
    host.icon = 'search';
    fixture.detectChanges();
    expect(root().querySelector('.icon-wrap__icon')?.textContent?.trim()).toBe('search');
  });
});
