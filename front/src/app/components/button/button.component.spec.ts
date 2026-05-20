import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ButtonComponent, ButtonVariant } from './button.component';

@Component({
  standalone: true,
  imports: [ButtonComponent],
  template: `
    <app-button
      [variant]="variant"
      [size]="size"
      [cta]="cta"
      [full]="full"
      [loading]="loading"
      [disabled]="disabled"
      [link]="link"
      [ariaLabel]="ariaLabel">
      Label
    </app-button>
  `,
})
class HostComponent {
  variant: ButtonVariant = 'primary';
  size: 'sm' | 'md' | 'lg' = 'md';
  cta = false;
  full = false;
  loading = false;
  disabled = false;
  link: string | undefined = undefined;
  ariaLabel: string | undefined = undefined;
}

describe('ButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function el(): HTMLElement {
    return fixture.nativeElement.querySelector('app-button');
  }

  it('renders a native <button> by default with variant + size classes', () => {
    fixture.detectChanges();
    expect(el().querySelector('button.btn__el')).toBeTruthy();
    expect(el().classList.contains('btn')).toBeTrue();
    expect(el().classList.contains('btn--primary')).toBeTrue();
    expect(el().classList.contains('btn--md')).toBeTrue();
  });

  it('reflects variant + size + modifier inputs as host classes', () => {
    host.variant = 'danger';
    host.size = 'lg';
    host.cta = true;
    host.full = true;
    fixture.detectChanges();
    expect(el().classList.contains('btn--danger')).toBeTrue();
    expect(el().classList.contains('btn--lg')).toBeTrue();
    expect(el().classList.contains('btn--cta')).toBeTrue();
    expect(el().classList.contains('btn--full')).toBeTrue();
  });

  it('renders an <a> when link is set', () => {
    host.link = '/decks';
    fixture.detectChanges();
    expect(el().querySelector('a.btn__el')).toBeTruthy();
    expect(el().querySelector('button.btn__el')).toBeNull();
  });

  it('disables the button when disabled or loading', () => {
    host.disabled = true;
    fixture.detectChanges();
    expect((el().querySelector('button') as HTMLButtonElement).disabled).toBeTrue();

    host.disabled = false;
    host.loading = true;
    fixture.detectChanges();
    expect((el().querySelector('button') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('renders the spinner + aria-busy when loading', () => {
    host.loading = true;
    fixture.detectChanges();
    expect(el().querySelector('.btn__spinner')).toBeTruthy();
    expect(el().querySelector('button')?.getAttribute('aria-busy')).toBe('true');
  });

  it('forwards aria-label', () => {
    host.ariaLabel = 'Save deck';
    fixture.detectChanges();
    expect(el().querySelector('button')?.getAttribute('aria-label')).toBe('Save deck');
  });
});
