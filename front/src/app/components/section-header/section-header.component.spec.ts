import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SectionHeaderComponent } from './section-header.component';

@Component({
  standalone: true,
  imports: [SectionHeaderComponent],
  template: `
    <app-section-header [titleKey]="titleKey" [count]="count" [countKey]="countKey">
      <button class="action">Action</button>
    </app-section-header>
  `,
})
class HostComponent {
  titleKey = 'section.title';
  count: number | null = null;
  countKey: string | undefined = undefined;
}

describe('SectionHeaderComponent', () => {
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
    return fixture.nativeElement.querySelector('.section-header');
  }

  it('renders the title (translated key)', () => {
    fixture.detectChanges();
    expect(root().querySelector('.section-header__title')?.textContent?.trim()).toBe('section.title');
  });

  it('hides the count badge when count is null', () => {
    fixture.detectChanges();
    expect(root().querySelector('.badge')).toBeNull();
  });

  it('shows the count badge when count is set', () => {
    host.count = 7;
    fixture.detectChanges();
    const badge = root().querySelector('.badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent?.trim()).toBe('7');
  });

  it('uses countKey for the badge when provided', () => {
    host.count = 3;
    host.countKey = 'section.itemsCount';
    fixture.detectChanges();
    const badge = root().querySelector('.badge');
    expect(badge?.textContent?.trim()).toBe('section.itemsCount');
    expect(badge?.getAttribute('aria-label')).toBe('section.itemsCount');
  });

  it('projects slotted content next to the title group', () => {
    fixture.detectChanges();
    const projected = root().querySelector('.action');
    expect(projected).not.toBeNull();
    expect(projected?.textContent?.trim()).toBe('Action');
  });
});
