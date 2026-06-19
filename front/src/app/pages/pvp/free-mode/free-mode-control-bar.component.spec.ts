import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { FreeModeControlBarComponent } from './free-mode-control-bar.component';
import { CommandStackService } from './engine/command-stack.service';

// =============================================================================
// FreeModeControlBarComponent — undo / redo / reset. Extracted from the sim
// control-bar WITHOUT its Router/back leak (chantier 2 first step). Reset uses
// the platform-agnostic ConfirmDialog.
// =============================================================================

describe('FreeModeControlBarComponent', () => {
  let fixture: ComponentFixture<FreeModeControlBarComponent>;
  let component: FreeModeControlBarComponent;
  let mockStack: jasmine.SpyObj<CommandStackService>;
  let mockDialog: jasmine.SpyObj<MatDialog>;

  function buttonByLabel(label: string): HTMLButtonElement | null {
    const host = fixture.nativeElement as HTMLElement;
    return host.querySelector<HTMLElement>(`app-icon-button[ariaLabel="${label}"]`)
      ?.querySelector('button') ?? null;
  }

  beforeEach(() => {
    // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
    const canUndo = signal(true);
    // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
    const canRedo = signal(true);
    mockStack = jasmine.createSpyObj<CommandStackService>(
      'CommandStackService', ['undo', 'redo', 'reset'], { canUndo, canRedo },
    );
    mockDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);

    TestBed.configureTestingModule({
      imports: [FreeModeControlBarComponent],
      providers: [
        { provide: CommandStackService, useValue: mockStack },
        { provide: MatDialog, useValue: mockDialog },
        { provide: TranslateService, useValue: { get: () => of({}) } },
      ],
    });
    fixture = TestBed.createComponent(FreeModeControlBarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('undo button calls CommandStack.undo', () => {
    buttonByLabel('Annuler (Ctrl+Z)')!.click();
    expect(mockStack.undo).toHaveBeenCalled();
  });

  it('redo button calls CommandStack.redo', () => {
    buttonByLabel('Rétablir (Ctrl+Y)')!.click();
    expect(mockStack.redo).toHaveBeenCalled();
  });

  it('reset opens the confirm dialog and resets when confirmed', async () => {
    mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

    await component.onReset();

    expect(mockDialog.open).toHaveBeenCalled();
    expect(mockStack.reset).toHaveBeenCalled();
  });

  it('emits didReset after a confirmed reset (so the page clears off-stack state)', async () => {
    mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    const fired: string[] = [];
    component.didReset.subscribe(() => fired.push('reset'));

    await component.onReset();

    expect(fired).toEqual(['reset']);
  });

  it('does NOT emit didReset when the reset is cancelled', async () => {
    mockDialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
    const fired: string[] = [];
    component.didReset.subscribe(() => fired.push('reset'));

    await component.onReset();

    expect(fired).toEqual([]);
  });

  it('reset does NOT reset when the dialog is cancelled', async () => {
    mockDialog.open.and.returnValue({ afterClosed: () => of(false) } as never);

    await component.onReset();

    expect(mockStack.reset).not.toHaveBeenCalled();
  });

  it('does NOT inject Router (no /decks back leak) — reset is dialog-only', () => {
    // Structural pin: the component must not navigate. If a Router back-button
    // ever leaks in, this component would need Router in its providers and this
    // test (no Router provided) would fail to construct.
    expect(component).toBeTruthy();
  });
});
