import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SegButtonComponent } from './seg-button.component';

@Component({
  standalone: true,
  imports: [SegButtonComponent],
  template: `
    <app-seg-button
      [active]="active"
      [disabled]="disabled"
      [checked]="checked"
      ariaLabel="Grid view">
      <span class="probe">G</span>
    </app-seg-button>
  `,
})
class HostComponent {
  active = false;
  disabled = false;
  checked: boolean | undefined = undefined;
}

describe('SegButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function el(): HTMLElement {
    return fixture.nativeElement.querySelector('app-seg-button');
  }

  it('renders a native <button> with the base class and projects content', () => {
    fixture.detectChanges();
    expect(el().querySelector('button.seg-btn__el')).toBeTruthy();
    expect(el().classList.contains('seg-btn')).toBeTrue();
    expect(el().querySelector('button .probe')?.textContent?.trim()).toBe('G');
  });

  it('toggles the --active host class', () => {
    host.active = true;
    fixture.detectChanges();
    expect(el().classList.contains('seg-btn--active')).toBeTrue();
  });

  it('forwards the required aria-label', () => {
    fixture.detectChanges();
    expect(el().querySelector('button')?.getAttribute('aria-label')).toBe('Grid view');
  });

  it('renders no role when checked is undefined (plain toggle)', () => {
    fixture.detectChanges();
    expect(el().querySelector('button')?.getAttribute('role')).toBeNull();
    expect(el().querySelector('button')?.getAttribute('aria-checked')).toBeNull();
  });

  it('renders role=radio + aria-checked when checked is set', () => {
    host.checked = true;
    fixture.detectChanges();
    expect(el().querySelector('button')?.getAttribute('role')).toBe('radio');
    expect(el().querySelector('button')?.getAttribute('aria-checked')).toBe('true');

    host.checked = false;
    fixture.detectChanges();
    expect(el().querySelector('button')?.getAttribute('aria-checked')).toBe('false');
  });

  it('disables the inner button', () => {
    host.disabled = true;
    fixture.detectChanges();
    expect((el().querySelector('button') as HTMLButtonElement).disabled).toBeTrue();
  });
});
