import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FreeModePileBarComponent } from './free-mode-pile-bar.component';

// =============================================================================
// FreeModePileBarComponent — the pile mini-bar (§6.2 / T4). Browse always;
// shuffle / mill / reveal only for DECK; N via a DS number input (never
// window.prompt). Presentational: outputs only.
// =============================================================================

describe('FreeModePileBarComponent', () => {
  let fixture: ComponentFixture<FreeModePileBarComponent>;
  let component: FreeModePileBarComponent;

  function buttonByLabel(label: string): HTMLButtonElement | null {
    const host = fixture.nativeElement as HTMLElement;
    return host.querySelector<HTMLElement>(`app-icon-button[ariaLabel="${label}"]`)
      ?.querySelector('button') ?? null;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FreeModePileBarComponent] });
    fixture = TestBed.createComponent(FreeModePileBarComponent);
    component = fixture.componentInstance;
  });

  it('shows only Browse for a non-deck pile (GY)', () => {
    fixture.componentRef.setInput('zone', 'GY');
    fixture.detectChanges();
    expect(buttonByLabel('Parcourir la pile')).toBeTruthy();
    expect(buttonByLabel('Mélanger le deck')).toBeNull();
    expect(buttonByLabel('Défausser N cartes (mill)')).toBeNull();
    expect(buttonByLabel('Révéler N cartes')).toBeNull();
  });

  it('shows shuffle / mill / reveal for the DECK', () => {
    fixture.componentRef.setInput('zone', 'DECK');
    fixture.detectChanges();
    expect(buttonByLabel('Mélanger le deck')).toBeTruthy();
    expect(buttonByLabel('Défausser N cartes (mill)')).toBeTruthy();
    expect(buttonByLabel('Révéler N cartes')).toBeTruthy();
  });

  it('emits browse / shuffle on click', () => {
    fixture.componentRef.setInput('zone', 'DECK');
    fixture.detectChanges();
    const fired: string[] = [];
    component.browse.subscribe(() => fired.push('browse'));
    component.shuffle.subscribe(() => fired.push('shuffle'));

    buttonByLabel('Parcourir la pile')!.click();
    buttonByLabel('Mélanger le deck')!.click();

    expect(fired).toEqual(['browse', 'shuffle']);
  });

  it('emits mill / reveal with the current count (floored at 1)', () => {
    fixture.componentRef.setInput('zone', 'DECK');
    fixture.detectChanges();
    const mills: number[] = [];
    const reveals: number[] = [];
    component.mill.subscribe(n => mills.push(n));
    component.reveal.subscribe(n => reveals.push(n));

    component.count.set(3);
    buttonByLabel('Défausser N cartes (mill)')!.click();
    buttonByLabel('Révéler N cartes')!.click();

    expect(mills).toEqual([3]);
    expect(reveals).toEqual([3]);
  });

  it('floors the count at 1 even if the input goes to 0 / negative', () => {
    fixture.componentRef.setInput('zone', 'DECK');
    fixture.detectChanges();
    const mills: number[] = [];
    component.mill.subscribe(n => mills.push(n));

    component.count.set(0);
    buttonByLabel('Défausser N cartes (mill)')!.click();

    expect(mills).toEqual([1]);
  });
});
