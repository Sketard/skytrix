import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconButtonComponent, IconButtonSize, IconButtonVariant } from './icon-button.component';

@Component({
  standalone: true,
  imports: [IconButtonComponent],
  template: `
    <app-icon-button
      [size]="size"
      [variant]="variant"
      [active]="active"
      [round]="round"
      [disabled]="disabled"
      ariaLabel="Close">
      <span class="probe">x</span>
    </app-icon-button>
  `,
})
class HostComponent {
  size: IconButtonSize = 'md';
  variant: IconButtonVariant = 'ghost';
  active = false;
  round = false;
  disabled = false;
}

describe('IconButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function el(): HTMLElement {
    return fixture.nativeElement.querySelector('app-icon-button');
  }

  it('renders a native <button> with base + variant + size classes', () => {
    fixture.detectChanges();
    expect(el().querySelector('button.icon-btn__el')).toBeTruthy();
    expect(el().classList.contains('icon-btn')).toBeTrue();
    expect(el().classList.contains('icon-btn--ghost')).toBeTrue();
    expect(el().classList.contains('icon-btn--md')).toBeTrue();
  });

  it('reflects size + variant + state inputs as host classes', () => {
    host.size = 'xl';
    host.variant = 'primary';
    host.active = true;
    host.round = true;
    fixture.detectChanges();
    expect(el().classList.contains('icon-btn--xl')).toBeTrue();
    expect(el().classList.contains('icon-btn--primary')).toBeTrue();
    expect(el().classList.contains('icon-btn--active')).toBeTrue();
    expect(el().classList.contains('icon-btn--round')).toBeTrue();
  });

  it('forwards the required aria-label to the inner button', () => {
    fixture.detectChanges();
    expect(el().querySelector('button')?.getAttribute('aria-label')).toBe('Close');
  });

  it('projects content into the button', () => {
    fixture.detectChanges();
    expect(el().querySelector('button .probe')?.textContent?.trim()).toBe('x');
  });

  it('disables the inner button when disabled', () => {
    host.disabled = true;
    fixture.detectChanges();
    expect((el().querySelector('button') as HTMLButtonElement).disabled).toBeTrue();
  });
});
