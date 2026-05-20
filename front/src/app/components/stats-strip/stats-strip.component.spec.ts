import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { StatItem, StatsStripComponent } from './stats-strip.component';

@Component({
  standalone: true,
  imports: [StatsStripComponent],
  template: `<app-stats-strip [stats]="stats" [ariaLabelKey]="ariaLabelKey"></app-stats-strip>`,
})
class HostComponent {
  stats: StatItem[] = [];
  ariaLabelKey: string | undefined = undefined;
}

describe('StatsStripComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function root(): HTMLElement {
    return fixture.nativeElement.querySelector('.stats-strip');
  }

  it('renders one item per stat with label + value', () => {
    host.stats = [
      { labelKey: 'stat.a', value: 1 },
      { labelKey: 'stat.b', value: '42%' },
    ];
    fixture.detectChanges();

    const items = root().querySelectorAll('.stats-strip__item');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('.stats-strip__value')?.textContent?.trim()).toBe('1');
    expect(items[1].querySelector('.stats-strip__value')?.textContent?.trim()).toBe('42%');
    expect(items[1].querySelector('.stats-strip__label')?.textContent?.trim()).toBe('stat.b');
  });

  it('skips the icon avatar when stat.icon is not provided', () => {
    host.stats = [{ labelKey: 'stat.a', value: 1 }];
    fixture.detectChanges();

    expect(root().querySelector('.stats-strip__icon')).toBeNull();
  });

  it('renders the icon avatar with the requested variant when stat.icon is set', () => {
    host.stats = [{ labelKey: 'stat.a', value: 1, icon: 'emoji_events', iconVariant: 'gold' }];
    fixture.detectChanges();

    const iconWrap = root().querySelector('.stats-strip__icon');
    expect(iconWrap).not.toBeNull();
    expect(iconWrap?.classList.contains('stats-strip__icon--gold')).toBeTrue();
    expect(iconWrap?.querySelector('mat-icon')?.textContent?.trim()).toBe('emoji_events');
  });

  it('applies valueVariant class', () => {
    host.stats = [{ labelKey: 'stat.a', value: 1, valueVariant: 'gold' }];
    fixture.detectChanges();

    expect(root().querySelector('.stats-strip__value--gold')).not.toBeNull();
  });

  it('applies surfaceAccent class', () => {
    host.stats = [{ labelKey: 'stat.a', value: 1, surfaceAccent: 'cyan' }];
    fixture.detectChanges();

    expect(root().querySelector('.stats-strip__item--accent-cyan')).not.toBeNull();
  });

  it('sets translated aria-label when ariaLabelKey provided', () => {
    host.stats = [{ labelKey: 'stat.a', value: 1 }];
    host.ariaLabelKey = 'a11y.stats';
    fixture.detectChanges();

    expect(root().getAttribute('aria-label')).toBe('a11y.stats');
  });
});
