import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { IconWrapPalette } from '../icon-wrap/icon-wrap.component';
import { PageShellComponent } from './page-shell.component';

@Component({
  standalone: true,
  imports: [PageShellComponent],
  template: `
    <app-page-shell
      [titleKey]="titleKey"
      [subtitleKey]="subtitleKey"
      [icon]="icon"
      [iconWrapPalette]="iconWrapPalette"
      [backRoute]="backRoute"
      [backActionEnabled]="backActionEnabled"
      [backLabelKey]="backLabelKey"
      [compact]="compact"
      [bordered]="bordered"
      (backAction)="onBack()">
      <button class="action" header-actions>Action</button>
      <div class="body-marker">Body</div>
    </app-page-shell>
  `,
})
class HostComponent {
  titleKey = 'page.title';
  subtitleKey: string | undefined;
  icon: string | undefined;
  iconWrapPalette: IconWrapPalette | null = null;
  backRoute: string | null = null;
  backActionEnabled = false;
  backLabelKey = 'common.back';
  compact = false;
  bordered = false;
  backClicks = 0;
  onBack(): void { this.backClicks++; }
}

describe('PageShellComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function header(): HTMLElement {
    return fixture.nativeElement.querySelector('.page-header');
  }
  /** The <app-button> host carrying `.page-shell__back`, or null. */
  function backHost(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.page-shell__back');
  }
  /** The real interactive <a>/<button> rendered inside <app-button>. */
  function backEl(): HTMLAnchorElement | HTMLButtonElement | null {
    return backHost()?.querySelector('.btn__el') ?? null;
  }

  it('renders the title and decorative screen-bg', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.screen-bg')).not.toBeNull();
    expect(header().querySelector('.page-header__title')?.textContent?.trim()).toBe('page.title');
  });

  it('renders subtitle when provided', () => {
    host.subtitleKey = 'page.subtitle';
    fixture.detectChanges();
    expect(header().querySelector('.page-header__subtitle')?.textContent?.trim()).toBe('page.subtitle');
  });

  it('renders a plain <mat-icon> when icon is set without iconWrapPalette', () => {
    host.icon = 'folder';
    fixture.detectChanges();
    expect(header().querySelector('.page-header__icon')?.textContent?.trim()).toBe('folder');
    expect(header().querySelector('app-icon-wrap')).toBeNull();
  });

  it('renders <app-icon-wrap> when iconWrapPalette is set', () => {
    host.icon = 'folder';
    host.iconWrapPalette = 'gold';
    fixture.detectChanges();
    expect(header().querySelector('app-icon-wrap')).not.toBeNull();
    expect(header().querySelector('.page-header__icon')).toBeNull();
  });

  it('renders a routerLink back when backRoute is set', () => {
    host.backRoute = '/lobby';
    fixture.detectChanges();
    const el = backEl() as HTMLAnchorElement;
    expect(el?.tagName).toBe('A');
    expect(el?.getAttribute('href')).toBe('/lobby');
  });

  it('renders a button back when backActionEnabled and emits on click', () => {
    host.backActionEnabled = true;
    fixture.detectChanges();
    const el = backEl() as HTMLButtonElement;
    expect(el?.tagName).toBe('BUTTON');
    el.click();
    expect(host.backClicks).toBe(1);
  });

  it('prefers backRoute over backAction when both are set', () => {
    host.backRoute = '/lobby';
    host.backActionEnabled = true;
    fixture.detectChanges();
    expect(backEl()?.tagName).toBe('A');
  });

  it('renders neither back variant when neither input is set', () => {
    fixture.detectChanges();
    expect(backEl()).toBeNull();
  });

  it('projects [header-actions] content into the header', () => {
    fixture.detectChanges();
    expect(header().querySelector('.action')).not.toBeNull();
  });

  it('projects default content below the header', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.body-marker')).not.toBeNull();
  });

  it('applies --compact and --bordered variant classes', () => {
    host.compact = true;
    host.bordered = true;
    fixture.detectChanges();
    expect(header().classList.contains('page-header--compact')).toBeTrue();
    expect(header().classList.contains('page-header--bordered')).toBeTrue();
  });
});
