import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FreeModeLpBarComponent } from './free-mode-lp-bar.component';

// =============================================================================
// FreeModeLpBarComponent — the LP editor (§4, a NEW free-mode capability).
// Quick ±1000 / ±100 + direct DS input, floored at 0. Presentational: emits
// lpChange with the already-floored value.
// =============================================================================

describe('FreeModeLpBarComponent', () => {
  let fixture: ComponentFixture<FreeModeLpBarComponent>;
  let component: FreeModeLpBarComponent;

  function buttonByLabel(label: string): HTMLButtonElement | null {
    const host = fixture.nativeElement as HTMLElement;
    return host.querySelector<HTMLElement>(`app-icon-button[ariaLabel="${label}"]`)
      ?.querySelector('button') ?? null;
  }

  function emitted(): number[] {
    const out: number[] = [];
    component.lpChange.subscribe(v => out.push(v));
    return out;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FreeModeLpBarComponent] });
    fixture = TestBed.createComponent(FreeModeLpBarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('lp', 8000);
    fixture.detectChanges();
  });

  it('steps LP up / down by 1000 and 100', () => {
    const out = emitted();
    buttonByLabel('Ajouter 1000 PV')!.click();
    buttonByLabel('Retirer 100 PV')!.click();
    expect(out).toEqual([9000, 7900]);
  });

  it('floors LP at 0 (never negative)', () => {
    fixture.componentRef.setInput('lp', 500);
    fixture.detectChanges();
    const out = emitted();
    buttonByLabel('Retirer 1000 PV')!.click();
    expect(out).toEqual([0]);
  });

  it('sets an exact value from the raw input string, floored', () => {
    const out = emitted();
    component['setExact']('12345.9');
    expect(out).toEqual([12345]);
  });

  it('floors an exact value at 0 (negative typed)', () => {
    const out = emitted();
    component['setExact']('-50');
    expect(out).toEqual([0]);
  });

  it('ignores an empty / non-numeric input instead of snapping to 0', () => {
    // Clearing the field to retype must NOT emit 0 (would fight the edit via
    // the [ngModel]="lp()" round-trip). Review P6.
    const out = emitted();
    component['setExact']('');
    component['setExact']('   ');
    component['setExact']('-');
    component['setExact']('abc');
    expect(out).toEqual([]);
  });
});
