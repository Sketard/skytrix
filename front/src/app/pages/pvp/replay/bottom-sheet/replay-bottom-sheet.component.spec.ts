import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateFakeLoader, TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { ReplayBottomSheetComponent } from './replay-bottom-sheet.component';

describe('ReplayBottomSheetComponent', () => {
  let fixture: ComponentFixture<ReplayBottomSheetComponent>;
  let el: HTMLElement;

  function setup(withDialog: boolean) {
    TestBed.resetTestingModule();
    const providers: unknown[] = [provideNoopAnimations()];
    if (withDialog) providers.push({ provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } });
    TestBed.configureTestingModule({
      imports: [
        ReplayBottomSheetComponent,
        MatDialogModule,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
      ],
      providers: providers as never,
    });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(ReplayBottomSheetComponent);
    fixture.componentRef.setInput('title', 'Options');
    el = fixture.nativeElement;
  }

  it('renders the shared <app-bottom-sheet-handle> as the first child of .bottom-sheet', () => {
    setup(false);
    fixture.detectChanges();
    const sheet = el.querySelector('.bottom-sheet');
    expect(sheet?.firstElementChild?.tagName.toLowerCase()).toBe('app-bottom-sheet-handle');
  });

  it('renders the title text + optional icon', () => {
    setup(false);
    fixture.componentRef.setInput('icon', 'tune');
    fixture.detectChanges();
    expect(el.querySelector('.bottom-sheet-title span:last-child')?.textContent?.trim()).toBe('Options');
    expect(el.querySelector('.bottom-sheet-title .material-icons-round')?.textContent?.trim()).toBe('tune');
  });

  it('omits the icon span entirely when icon input is empty', () => {
    setup(false);
    fixture.detectChanges();
    expect(el.querySelector('.bottom-sheet-title .material-icons-round')).toBeNull();
  });

  it('projects <ng-content> into .bottom-sheet-body', () => {
    setup(false);
    fixture.detectChanges();
    // ng-content stays empty in this isolated harness — verify the body exists for projection.
    expect(el.querySelector('.bottom-sheet-body')).not.toBeNull();
  });

  it('closes via MatDialogRef.close() when injected', () => {
    setup(true);
    fixture.detectChanges();
    const dialogRef = TestBed.inject(MatDialogRef) as unknown as { close: jasmine.Spy };
    (el.querySelector('.bottom-sheet-close') as HTMLButtonElement).click();
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('emits close output when no MatDialogRef is injected', () => {
    setup(false);
    fixture.detectChanges();
    const closeSpy = spyOn(fixture.componentInstance.close, 'emit');
    (el.querySelector('.bottom-sheet-close') as HTMLButtonElement).click();
    expect(closeSpy).toHaveBeenCalled();
  });
});
