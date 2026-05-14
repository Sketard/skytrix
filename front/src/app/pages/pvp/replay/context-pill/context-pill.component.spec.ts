import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ContextPillComponent } from './context-pill.component';

describe('ContextPillComponent', () => {
  let fixture: ComponentFixture<ContextPillComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContextPillComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(ContextPillComponent);
    el = fixture.nativeElement;
  });

  it('always renders the turn pill', () => {
    fixture.componentRef.setInput('turnLabel', 'Tour 3 / 11 tours');
    fixture.detectChanges();
    const turn = el.querySelector('.context-pill__turn');
    expect(turn?.textContent?.trim()).toBe('Tour 3 / 11 tours');
    expect(turn?.className).toContain('pill--gold');
  });

  it('omits optional sub-elements when their inputs are null', () => {
    fixture.componentRef.setInput('turnLabel', 'T0 · Setup');
    fixture.detectChanges();
    expect(el.querySelector('.context-pill__position')).toBeNull();
    expect(el.querySelector('.context-pill__phase')).toBeNull();
    expect(el.querySelector('.context-pill__event')).toBeNull();
  });

  it('renders all 4 zones when every input is provided', () => {
    fixture.componentRef.setInput('turnLabel', 'Tour 5 / 11');
    fixture.componentRef.setInput('position', 'P1');
    fixture.componentRef.setInput('phase', 'Main 1');
    fixture.componentRef.setInput('eventLabel', 'Activation : Ash Blossom');
    fixture.detectChanges();
    expect(el.querySelector('.context-pill__turn')).not.toBeNull();
    expect(el.querySelector('.context-pill__position')?.textContent?.trim()).toBe('P1');
    expect(el.querySelector('.context-pill__phase')?.textContent?.trim()).toBe('Main 1');
    expect(el.querySelector('.context-pill__event')?.textContent?.trim()).toBe('Activation : Ash Blossom');
  });

  it('uses DS pill utility classes (no inline visual styles)', () => {
    fixture.componentRef.setInput('turnLabel', 'X');
    fixture.componentRef.setInput('phase', 'Main 1');
    fixture.detectChanges();
    expect(el.querySelector('.context-pill__turn')?.classList.contains('pill--gold')).toBe(true);
    expect(el.querySelector('.context-pill__phase')?.classList.contains('pill--cyan')).toBe(true);
  });
});
