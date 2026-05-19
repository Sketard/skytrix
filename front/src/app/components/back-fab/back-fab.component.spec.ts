import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BackFabComponent } from './back-fab.component';

@Component({
  standalone: true,
  imports: [BackFabComponent],
  template: `
    <app-back-fab
      [visible]="visible"
      [ariaLabelKey]="ariaLabelKey"
      (back)="onBack()">
    </app-back-fab>
  `,
})
class HostComponent {
  visible = true;
  ariaLabelKey = 'replay.hub.back';
  clicks = 0;
  onBack(): void { this.clicks++; }
}

describe('BackFabComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function btn(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button.back-fab');
  }
  function fab(): HTMLElement {
    return fixture.nativeElement.querySelector('app-back-fab');
  }

  it('renders the button with the translated aria-label', () => {
    fixture.detectChanges();
    expect(btn()).not.toBeNull();
    expect(btn().getAttribute('aria-label')).toBe('replay.hub.back');
    expect(btn().querySelector('mat-icon')?.textContent?.trim()).toBe('arrow_back');
  });

  it('applies the --hidden host class when visible=false', () => {
    host.visible = false;
    fixture.detectChanges();
    expect(fab().classList.contains('back-fab--hidden')).toBeTrue();
  });

  it('omits the --hidden host class when visible=true', () => {
    host.visible = true;
    fixture.detectChanges();
    expect(fab().classList.contains('back-fab--hidden')).toBeFalse();
  });

  it('emits back on click', () => {
    fixture.detectChanges();
    btn().click();
    expect(host.clicks).toBe(1);
  });
});
