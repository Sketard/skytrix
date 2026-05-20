import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent', () => {
  let fixture: ComponentFixture<EmptyStateComponent>;
  let component: EmptyStateComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmptyStateComponent, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(EmptyStateComponent);
    component = fixture.componentInstance;
  });

  function root(): HTMLElement {
    return fixture.nativeElement.querySelector('.empty-state');
  }

  it('renders required title only', () => {
    fixture.componentRef.setInput('titleKey', 'empty.title');
    fixture.detectChanges();

    expect(root()).not.toBeNull();
    expect(root().classList.contains('empty-state--default')).toBeFalse();
    expect(root().querySelector('.empty-state__title')?.textContent?.trim()).toBe('empty.title');
    expect(root().querySelector('.empty-state__icon')).toBeNull();
    expect(root().querySelector('.empty-state__desc')).toBeNull();
    expect(root().querySelector('.btn')).toBeNull();
  });

  it('applies variant class for non-default variants', () => {
    fixture.componentRef.setInput('titleKey', 'empty.title');
    fixture.componentRef.setInput('variant', 'error');
    fixture.detectChanges();

    expect(root().classList.contains('empty-state--error')).toBeTrue();
  });

  it('renders icon when provided', () => {
    fixture.componentRef.setInput('titleKey', 'empty.title');
    fixture.componentRef.setInput('icon', 'wifi_off');
    fixture.detectChanges();

    const icon = root().querySelector('.empty-state__icon');
    expect(icon?.textContent?.trim()).toBe('wifi_off');
  });

  it('renders desc when descKey provided', () => {
    fixture.componentRef.setInput('titleKey', 'empty.title');
    fixture.componentRef.setInput('descKey', 'empty.desc');
    fixture.detectChanges();

    expect(root().querySelector('.empty-state__desc')?.textContent?.trim()).toBe('empty.desc');
  });

  it('renders <a> CTA when ctaLink + ctaLabelKey provided', () => {
    fixture.componentRef.setInput('titleKey', 'empty.title');
    fixture.componentRef.setInput('ctaLabelKey', 'cta.create');
    fixture.componentRef.setInput('ctaLink', '/decks/builder');
    fixture.detectChanges();

    const link = root().querySelector('app-button a.btn__el');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/decks/builder');
    expect(link?.textContent).toContain('cta.create');
  });

  it('renders <button> CTA when only ctaLabelKey provided and emits ctaAction', () => {
    fixture.componentRef.setInput('titleKey', 'empty.title');
    fixture.componentRef.setInput('ctaLabelKey', 'cta.retry');
    fixture.detectChanges();

    const btn = root().querySelector('app-button button.btn__el') as HTMLButtonElement;
    expect(btn).not.toBeNull();

    let emitted = false;
    component.ctaAction.subscribe(() => (emitted = true));
    btn.click();
    expect(emitted).toBeTrue();
  });

  it('uses secondary variant when ctaVariant=secondary', () => {
    fixture.componentRef.setInput('titleKey', 'empty.title');
    fixture.componentRef.setInput('ctaLabelKey', 'cta.retry');
    fixture.componentRef.setInput('ctaVariant', 'secondary');
    fixture.detectChanges();

    const appButton = root().querySelector('app-button');
    expect(appButton?.classList.contains('btn--secondary')).toBeTrue();
    expect(appButton?.classList.contains('btn--primary')).toBeFalse();
  });

  it('disables the CTA button when ctaDisabled=true', () => {
    fixture.componentRef.setInput('titleKey', 'empty.title');
    fixture.componentRef.setInput('ctaLabelKey', 'cta.create');
    fixture.componentRef.setInput('ctaDisabled', true);
    fixture.detectChanges();

    const btn = root().querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
  });

  it('renders ctaIcon inside the button when provided', () => {
    fixture.componentRef.setInput('titleKey', 'empty.title');
    fixture.componentRef.setInput('ctaLabelKey', 'cta.retry');
    fixture.componentRef.setInput('ctaIcon', 'refresh');
    fixture.detectChanges();

    const btnIcon = root().querySelector('button mat-icon');
    expect(btnIcon?.textContent?.trim()).toBe('refresh');
  });
});
