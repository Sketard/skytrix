import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CheckboxComponent } from './checkbox.component';

@Component({
  standalone: true,
  imports: [CheckboxComponent, ReactiveFormsModule],
  template: `
    <app-checkbox [formControl]="control" [disabled]="disabledInput" ariaLabel="Accept">
      Accept terms
    </app-checkbox>
  `,
})
class HostComponent {
  control = new FormControl(false);
  disabledInput = false;
}

describe('CheckboxComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function nativeInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input.checkbox__native');
  }

  it('renders a hidden native checkbox and projects the label', () => {
    fixture.detectChanges();
    expect(nativeInput()).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.checkbox__label')?.textContent?.trim())
      .toBe('Accept terms');
  });

  it('reflects the form value into the checkbox (writeValue)', () => {
    host.control.setValue(true);
    fixture.detectChanges();
    expect(nativeInput().checked).toBeTrue();
  });

  it('writes back to the form control when toggled', () => {
    fixture.detectChanges();
    nativeInput().click();
    expect(host.control.value).toBeTrue();
    nativeInput().click();
    expect(host.control.value).toBeFalse();
  });

  it('disables via the form control (setDisabledState)', () => {
    host.control.disable();
    fixture.detectChanges();
    expect(nativeInput().disabled).toBeTrue();
  });

  it('disables via the disabled input', () => {
    host.disabledInput = true;
    fixture.detectChanges();
    expect(nativeInput().disabled).toBeTrue();
  });

  it('forwards the aria-label to the native input', () => {
    fixture.detectChanges();
    expect(nativeInput().getAttribute('aria-label')).toBe('Accept');
  });
});
