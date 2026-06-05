import { Component, DebugElement, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { LongPressDirective } from './long-press.directive';

@Component({
  standalone: true,
  imports: [LongPressDirective],
  template: `
    <button
      #host
      type="button"
      (appLongPress)="onLongPress($event)"
      [appLongPressDuration]="duration"
      [appLongPressTolerance]="tolerance"
      (click)="onClick()"
    >press</button>
  `,
})
class HostComponent {
  @ViewChild('host', { static: true }) hostEl!: { nativeElement: HTMLButtonElement };
  duration = 500;
  tolerance = 12;
  longPressEvents: PointerEvent[] = [];
  clickCount = 0;
  onLongPress(e: PointerEvent): void { this.longPressEvents.push(e); }
  onClick(): void { this.clickCount++; }
}

function makePointerEvent(
  type: string,
  init: Partial<PointerEventInit> & { pointerType: string; pointerId: number; clientX: number; clientY: number },
): PointerEvent {
  // jsdom-style fallback if PointerEvent constructor is missing — Karma + ChromeHeadless
  // ships it but defensive-anyway.
  try {
    return new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
  } catch {
    const evt = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
    Object.assign(evt, init);
    return evt;
  }
}

describe('LongPressDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let btn: HTMLButtonElement;
  let directiveDe: DebugElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    btn = host.hostEl.nativeElement;
    directiveDe = fixture.debugElement.query(By.directive(LongPressDirective));
    expect(directiveDe).toBeTruthy();
  });

  it('mouse pointer does NOT fire long-press', fakeAsync(() => {
    btn.dispatchEvent(makePointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 10, clientY: 10 }));
    tick(1000);
    btn.dispatchEvent(makePointerEvent('pointerup', { pointerType: 'mouse', pointerId: 1, clientX: 10, clientY: 10 }));
    expect(host.longPressEvents.length).toBe(0);
  }));

  it('touch + 500ms hold fires long-press and suppresses the trailing click', fakeAsync(() => {
    btn.dispatchEvent(makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 10 }));
    tick(500);
    expect(host.longPressEvents.length).toBe(1);

    // Simulate the synthetic trailing click that the browser dispatches after pointerup.
    btn.dispatchEvent(makePointerEvent('pointerup', { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 10 }));
    btn.click();
    expect(host.clickCount).toBe(0);
  }));

  it('touch + 300ms early release clears the timer and the click goes through', fakeAsync(() => {
    btn.dispatchEvent(makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 3, clientX: 10, clientY: 10 }));
    tick(300);
    btn.dispatchEvent(makePointerEvent('pointerup', { pointerType: 'touch', pointerId: 3, clientX: 10, clientY: 10 }));
    tick(500);
    expect(host.longPressEvents.length).toBe(0);

    btn.click();
    expect(host.clickCount).toBe(1);
  }));

  it('touch + 600ms but moved >tolerance px → no firing', fakeAsync(() => {
    btn.dispatchEvent(makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 4, clientX: 10, clientY: 10 }));
    tick(200);
    btn.dispatchEvent(makePointerEvent('pointermove', { pointerType: 'touch', pointerId: 4, clientX: 35, clientY: 10 }));
    tick(500);
    expect(host.longPressEvents.length).toBe(0);
  }));

  it('pointercancel mid-press clears the timer (no firing)', fakeAsync(() => {
    btn.dispatchEvent(makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 5, clientX: 10, clientY: 10 }));
    tick(200);
    btn.dispatchEvent(makePointerEvent('pointercancel', { pointerType: 'touch', pointerId: 5, clientX: 10, clientY: 10 }));
    tick(500);
    expect(host.longPressEvents.length).toBe(0);
  }));

  it('honors a custom appLongPressDuration input', fakeAsync(() => {
    host.duration = 200;
    fixture.detectChanges();

    btn.dispatchEvent(makePointerEvent('pointerdown', { pointerType: 'touch', pointerId: 6, clientX: 10, clientY: 10 }));
    tick(199);
    expect(host.longPressEvents.length).toBe(0);

    tick(1);
    expect(host.longPressEvents.length).toBe(1);

    btn.dispatchEvent(makePointerEvent('pointerup', { pointerType: 'touch', pointerId: 6, clientX: 10, clientY: 10 }));
  }));
});
