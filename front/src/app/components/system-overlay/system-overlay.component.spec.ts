import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SystemOverlayComponent } from './system-overlay.component';

@Component({
  standalone: true,
  imports: [SystemOverlayComponent],
  template: `
    <app-system-overlay
      [variant]="variant"
      [title]="title"
      [subtitle]="subtitle"
      [ariaLabel]="ariaLabel"
      [pulseTitle]="pulseTitle">
      <button slot="actions" class="action-btn">go</button>
      <span slot="indicator" class="indicator-stub">spin</span>
    </app-system-overlay>
  `,
})
class HostComponent {
  variant: 'lost' | 'reconnecting' | 'grace' | 'blocked' = 'lost';
  title = '';
  subtitle = '';
  ariaLabel = '';
  pulseTitle = false;
}

describe('SystemOverlayComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function rootEl(): HTMLElement {
    return fixture.nativeElement.querySelector('.system-overlay');
  }

  it('applies variant class to root', () => {
    host.variant = 'lost';
    fixture.detectChanges();
    expect(rootEl().classList.contains('system-overlay--lost')).toBe(true);

    host.variant = 'grace';
    fixture.detectChanges();
    expect(rootEl().classList.contains('system-overlay--grace')).toBe(true);
    expect(rootEl().classList.contains('system-overlay--lost')).toBe(false);
  });

  it('renders title only when non-empty', () => {
    fixture.detectChanges();
    expect(rootEl().querySelector('.system-overlay__title')).toBeNull();

    host.title = 'Hello';
    fixture.detectChanges();
    const titleEl = rootEl().querySelector('.system-overlay__title');
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toContain('Hello');
  });

  it('renders subtitle only when non-empty', () => {
    fixture.detectChanges();
    expect(rootEl().querySelector('.system-overlay__subtitle')).toBeNull();

    host.subtitle = 'extra';
    fixture.detectChanges();
    expect(rootEl().querySelector('.system-overlay__subtitle')!.textContent).toContain('extra');
  });

  it('toggles the pulse modifier on the title element', () => {
    host.title = 'pulsing';
    host.pulseTitle = true;
    fixture.detectChanges();
    const titleEl = rootEl().querySelector('.system-overlay__title')!;
    expect(titleEl.classList.contains('system-overlay__title--pulse')).toBe(true);

    host.pulseTitle = false;
    fixture.detectChanges();
    expect(titleEl.classList.contains('system-overlay__title--pulse')).toBe(false);
  });

  it('uses role=alertdialog + aria-modal for modal variants (lost, blocked)', () => {
    host.variant = 'lost';
    fixture.detectChanges();
    expect(rootEl().getAttribute('role')).toBe('alertdialog');
    expect(rootEl().getAttribute('aria-modal')).toBe('true');
    expect(rootEl().getAttribute('aria-live')).toBeNull();

    host.variant = 'blocked';
    fixture.detectChanges();
    expect(rootEl().getAttribute('role')).toBe('alertdialog');
    expect(rootEl().getAttribute('aria-modal')).toBe('true');
  });

  it('uses role=status + aria-live=polite for live variants (reconnecting, grace)', () => {
    host.variant = 'reconnecting';
    fixture.detectChanges();
    expect(rootEl().getAttribute('role')).toBe('status');
    expect(rootEl().getAttribute('aria-live')).toBe('polite');
    expect(rootEl().getAttribute('aria-modal')).toBeNull();

    host.variant = 'grace';
    fixture.detectChanges();
    expect(rootEl().getAttribute('role')).toBe('status');
    expect(rootEl().getAttribute('aria-live')).toBe('polite');
  });

  it('falls back aria-label to title when ariaLabel input is empty', () => {
    host.title = 'My title';
    fixture.detectChanges();
    expect(rootEl().getAttribute('aria-label')).toBe('My title');
  });

  it('uses explicit ariaLabel input when provided', () => {
    host.title = 'My title';
    host.ariaLabel = 'A11y override';
    fixture.detectChanges();
    expect(rootEl().getAttribute('aria-label')).toBe('A11y override');
  });

  it('projects content into actions and indicator slots', () => {
    host.variant = 'reconnecting';
    fixture.detectChanges();
    expect(rootEl().querySelector('.action-btn')).not.toBeNull();
    expect(rootEl().querySelector('.indicator-stub')).not.toBeNull();
  });
});
