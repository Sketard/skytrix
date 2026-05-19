import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RadioCardColumns, RadioCardGroupComponent } from './radio-card-group.component';

@Component({
  standalone: true,
  imports: [RadioCardGroupComponent],
  template: `
    <app-radio-card-group [columns]="columns" [ariaLabel]="ariaLabel">
      <button class="child">A</button>
      <button class="child">B</button>
    </app-radio-card-group>
  `,
})
class HostComponent {
  columns: RadioCardColumns = 3;
  ariaLabel: string | null = null;
}

describe('RadioCardGroupComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function root(): HTMLElement {
    return fixture.nativeElement.querySelector('app-radio-card-group');
  }

  it('applies role=radiogroup and column class', () => {
    fixture.detectChanges();
    expect(root().getAttribute('role')).toBe('radiogroup');
    expect(root().classList.contains('radio-card-group--cols-3')).toBeTrue();
  });

  it('updates the column class when columns input changes', () => {
    host.columns = 2;
    fixture.detectChanges();
    expect(root().classList.contains('radio-card-group--cols-2')).toBeTrue();
    expect(root().classList.contains('radio-card-group--cols-3')).toBeFalse();
  });

  it('exposes the aria-label when provided', () => {
    host.ariaLabel = 'preferences.theme.title';
    fixture.detectChanges();
    expect(root().getAttribute('aria-label')).toBe('preferences.theme.title');
  });

  it('projects children', () => {
    fixture.detectChanges();
    expect(root().querySelectorAll('.child').length).toBe(2);
  });
});
