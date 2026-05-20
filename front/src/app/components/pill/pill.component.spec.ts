import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PillComponent, PillSize, PillVariant } from './pill.component';

@Component({
  standalone: true,
  imports: [PillComponent],
  template: `
    <app-pill [variant]="variant" [size]="size" [live]="live" [celebrated]="celebrated" [icon]="icon">
      Status
    </app-pill>
  `,
})
class HostComponent {
  variant: PillVariant = 'neutral';
  size: PillSize = 'sm';
  live = false;
  celebrated = false;
  icon: string | undefined = undefined;
}

describe('PillComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function el(): HTMLElement {
    return fixture.nativeElement.querySelector('app-pill');
  }

  it('renders the base + variant + size classes and projects the label', () => {
    fixture.detectChanges();
    expect(el().classList.contains('pill')).toBeTrue();
    expect(el().classList.contains('pill--neutral')).toBeTrue();
    expect(el().classList.contains('pill--sm')).toBeTrue();
    expect(el().textContent?.trim()).toBe('Status');
  });

  it('reflects variant + size + modifier inputs as host classes', () => {
    host.variant = 'gold';
    host.size = 'lg';
    host.live = true;
    host.celebrated = true;
    fixture.detectChanges();
    expect(el().classList.contains('pill--gold')).toBeTrue();
    expect(el().classList.contains('pill--lg')).toBeTrue();
    expect(el().classList.contains('pill--live')).toBeTrue();
    expect(el().classList.contains('pill--celebrated')).toBeTrue();
  });

  it('renders a leading pill__icon when icon is set', () => {
    host.icon = 'emoji_events';
    fixture.detectChanges();
    const icon = el().querySelector('mat-icon.pill__icon');
    expect(icon?.textContent?.trim()).toBe('emoji_events');
  });

  it('omits the icon when none is provided', () => {
    fixture.detectChanges();
    expect(el().querySelector('mat-icon.pill__icon')).toBeNull();
  });
});
