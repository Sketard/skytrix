import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { RadioCardComponent } from './radio-card.component';

@Component({
  standalone: true,
  imports: [RadioCardComponent],
  template: `
    <app-radio-card
      [labelKey]="labelKey"
      [descKey]="descKey"
      [active]="active"
      (select)="onSelect()">
    </app-radio-card>
  `,
})
class HostComponent {
  labelKey = 'card.label';
  descKey: string | undefined = undefined;
  active = false;
  selected = 0;
  onSelect(): void {
    this.selected++;
  }
}

describe('RadioCardComponent', () => {
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
    return fixture.nativeElement.querySelector('button.radio-card');
  }

  it('renders the label and aria-checked=false by default', () => {
    fixture.detectChanges();
    expect(btn().getAttribute('role')).toBe('radio');
    expect(btn().getAttribute('aria-checked')).toBe('false');
    expect(btn().querySelector('.radio-card__label')?.textContent?.trim()).toBe('card.label');
  });

  it('renders desc when descKey provided', () => {
    host.descKey = 'card.desc';
    fixture.detectChanges();
    expect(btn().querySelector('.radio-card__desc')?.textContent?.trim()).toBe('card.desc');
  });

  it('applies active class + aria-checked=true', () => {
    host.active = true;
    fixture.detectChanges();
    expect(btn().classList.contains('radio-card--active')).toBeTrue();
    expect(btn().getAttribute('aria-checked')).toBe('true');
  });

  it('emits select on click', () => {
    fixture.detectChanges();
    btn().click();
    expect(host.selected).toBe(1);
  });
});
