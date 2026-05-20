import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { InputComponent } from './input.component';

@Component({
  standalone: true,
  imports: [InputComponent, ReactiveFormsModule],
  template: `
    <app-input
      [formControl]="control"
      [label]="label"
      [invalid]="invalid"
      placeholder="Type here">
    </app-input>
  `,
})
class HostComponent {
  control = new FormControl('');
  label: string | undefined = undefined;
  invalid = false;
}

describe('InputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function field(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input.input__field');
  }

  it('renders an input with the placeholder', () => {
    fixture.detectChanges();
    expect(field()).toBeTruthy();
    expect(field().placeholder).toBe('Type here');
  });

  it('renders the label only when provided', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.input__label')).toBeNull();
    host.label = 'Deck name';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.input__label')?.textContent?.trim())
      .toBe('Deck name');
  });

  it('reflects the form value into the field (writeValue)', () => {
    host.control.setValue('Fireking');
    fixture.detectChanges();
    expect(field().value).toBe('Fireking');
  });

  it('writes back to the form control on input', () => {
    fixture.detectChanges();
    field().value = 'Snake-Eye';
    field().dispatchEvent(new Event('input'));
    expect(host.control.value).toBe('Snake-Eye');
  });

  it('disables via the form control', () => {
    host.control.disable();
    fixture.detectChanges();
    expect(field().disabled).toBeTrue();
  });

  it('sets aria-invalid + the invalid class when invalid', () => {
    host.invalid = true;
    fixture.detectChanges();
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.querySelector('.input--invalid')).toBeTruthy();
  });
});
