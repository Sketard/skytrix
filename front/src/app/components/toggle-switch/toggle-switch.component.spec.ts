import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ToggleSwitchComponent } from './toggle-switch.component';

@Component({
  standalone: true,
  imports: [ToggleSwitchComponent],
  template: `
    <app-toggle-switch
      [checked]="checked"
      [labelKey]="labelKey"
      [hintKey]="hintKey"
      (change)="onChange()">
    </app-toggle-switch>
  `,
})
class HostComponent {
  checked = false;
  labelKey = 'toggle.label';
  hintKey: string | undefined = undefined;
  changes = 0;
  onChange(): void {
    this.changes++;
  }
}

describe('ToggleSwitchComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function btn(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button.toggle-switch');
  }

  it('renders aria-checked=false and label', () => {
    fixture.detectChanges();
    expect(btn().getAttribute('role')).toBe('switch');
    expect(btn().getAttribute('aria-checked')).toBe('false');
    expect(btn().querySelector('.toggle-switch__label')?.textContent?.trim()).toBe('toggle.label');
    expect(btn().querySelector('.toggle-switch__hint')).toBeNull();
  });

  it('renders hint when hintKey provided', () => {
    host.hintKey = 'toggle.hint';
    fixture.detectChanges();
    expect(btn().querySelector('.toggle-switch__hint')?.textContent?.trim()).toBe('toggle.hint');
  });

  it('applies --on class when checked', () => {
    host.checked = true;
    fixture.detectChanges();
    expect(btn().classList.contains('toggle-switch--on')).toBeTrue();
    expect(btn().getAttribute('aria-checked')).toBe('true');
  });

  it('emits change on click', () => {
    fixture.detectChanges();
    btn().click();
    expect(host.changes).toBe(1);
  });
});
