import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChipComponent, ChipSize, ChipVariant } from './chip.component';

@Component({
  standalone: true,
  imports: [ChipComponent],
  template: `
    <app-chip
      [variant]="variant"
      [size]="size"
      [active]="active"
      [disabled]="disabled"
      [icon]="icon">
      Favourites
    </app-chip>
  `,
})
class HostComponent {
  variant: ChipVariant = 'gold';
  size: ChipSize = 'md';
  active = false;
  disabled = false;
  icon: string | undefined = undefined;
}

describe('ChipComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function el(): HTMLElement {
    return fixture.nativeElement.querySelector('app-chip');
  }

  it('renders a native <button> with the base class and projects the label', () => {
    fixture.detectChanges();
    expect(el().querySelector('button.chip__el')).toBeTruthy();
    expect(el().classList.contains('chip')).toBeTrue();
    expect(el().textContent?.trim()).toBe('Favourites');
  });

  it('reflects aria-pressed from active', () => {
    fixture.detectChanges();
    expect(el().querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
    host.active = true;
    fixture.detectChanges();
    expect(el().querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(el().classList.contains('chip--active')).toBeTrue();
  });

  it('reflects variant + size as host classes', () => {
    host.variant = 'cyan';
    host.size = 'sm';
    fixture.detectChanges();
    expect(el().classList.contains('chip--cyan')).toBeTrue();
    expect(el().classList.contains('chip--sm')).toBeTrue();
  });

  it('renders a leading chip__icon when icon is set', () => {
    host.icon = 'star';
    fixture.detectChanges();
    expect(el().querySelector('mat-icon.chip__icon')?.textContent?.trim()).toBe('star');
  });

  it('disables the inner button', () => {
    host.disabled = true;
    fixture.detectChanges();
    expect((el().querySelector('button') as HTMLButtonElement).disabled).toBeTrue();
  });
});
