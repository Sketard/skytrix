import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FreeModeActionBarComponent } from './free-mode-action-bar.component';

// =============================================================================
// FreeModeActionBarComponent — the mini-bar CARTE (§6.1). Presentational:
// each icon-button emits its action; "Détacher" shows only for materials;
// the counter decrement is disabled at 0 (mandatory recourse, §5.4).
// =============================================================================

describe('FreeModeActionBarComponent', () => {
  let fixture: ComponentFixture<FreeModeActionBarComponent>;
  let component: FreeModeActionBarComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FreeModeActionBarComponent] });
    fixture = TestBed.createComponent(FreeModeActionBarComponent);
    component = fixture.componentInstance;
  });

  function buttonByLabel(label: string): HTMLButtonElement | null {
    const host = fixture.nativeElement as HTMLElement;
    const el = host.querySelector<HTMLElement>(`app-icon-button[ariaLabel="${label}"]`);
    return el?.querySelector('button') ?? null;
  }

  it('renders the core actions (flip / position / activate / destroy / attach)', () => {
    fixture.detectChanges();
    expect(buttonByLabel('Changer de position face')).toBeTruthy();
    expect(buttonByLabel('Basculer ATK / DEF')).toBeTruthy();
    expect(buttonByLabel("Activer l'effet")).toBeTruthy();
    expect(buttonByLabel('Détruire (envoyer au cimetière)')).toBeTruthy();
    expect(buttonByLabel('Attacher comme matériau XYZ')).toBeTruthy();
  });

  it('hides "Détacher" when the card is NOT a material', () => {
    fixture.componentRef.setInput('isMaterial', false);
    fixture.detectChanges();
    expect(buttonByLabel('Détacher le matériau')).toBeNull();
  });

  it('shows "Détacher" when the card IS a material', () => {
    fixture.componentRef.setInput('isMaterial', true);
    fixture.detectChanges();
    expect(buttonByLabel('Détacher le matériau')).toBeTruthy();
  });

  it('each action button emits its output on click', () => {
    fixture.componentRef.setInput('isMaterial', true);
    fixture.detectChanges();

    const fired: string[] = [];
    component.flip.subscribe(() => fired.push('flip'));
    component.togglePosition.subscribe(() => fired.push('togglePosition'));
    component.activate.subscribe(() => fired.push('activate'));
    component.destroy.subscribe(() => fired.push('destroy'));
    component.detach.subscribe(() => fired.push('detach'));
    component.attachXyz.subscribe(() => fired.push('attachXyz'));
    component.incrementCounter.subscribe(() => fired.push('increment'));

    buttonByLabel('Changer de position face')!.click();
    buttonByLabel('Basculer ATK / DEF')!.click();
    buttonByLabel("Activer l'effet")!.click();
    buttonByLabel('Détruire (envoyer au cimetière)')!.click();
    buttonByLabel('Détacher le matériau')!.click();
    buttonByLabel('Attacher comme matériau XYZ')!.click();
    buttonByLabel('Ajouter un compteur')!.click();

    expect(fired).toEqual([
      'flip', 'togglePosition', 'activate', 'destroy', 'detach', 'attachXyz', 'increment',
    ]);
  });

  it('shows the current counter value', () => {
    fixture.componentRef.setInput('counterValue', 3);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.counter-value')?.textContent?.trim()).toBe('3');
  });

  it('disables the decrement button at 0 (mandatory recourse, §5.4)', () => {
    fixture.componentRef.setInput('counterValue', 0);
    fixture.detectChanges();
    expect(buttonByLabel('Retirer un compteur')!.disabled).toBe(true);
  });

  it('enables the decrement button above 0', () => {
    fixture.componentRef.setInput('counterValue', 1);
    fixture.detectChanges();
    const decBtn = buttonByLabel('Retirer un compteur')!;
    expect(decBtn.disabled).toBe(false);

    const fired: string[] = [];
    component.decrementCounter.subscribe(() => fired.push('decrement'));
    decBtn.click();
    expect(fired).toEqual(['decrement']);
  });
});
