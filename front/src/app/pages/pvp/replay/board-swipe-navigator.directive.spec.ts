import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BoardSwipeNavigatorDirective } from './board-swipe-navigator.directive';

@Component({
  standalone: true,
  imports: [BoardSwipeNavigatorDirective],
  template: `
    <div
      appBoardSwipeNavigator
      [appBoardSwipeNavigatorDisabled]="disabled"
      (swipeLeft)="leftCount = leftCount + 1"
      (swipeRight)="rightCount = rightCount + 1">
      target
    </div>
  `,
})
class HostComponent {
  @ViewChild(BoardSwipeNavigatorDirective) directive!: BoardSwipeNavigatorDirective;
  disabled = false;
  leftCount = 0;
  rightCount = 0;
}

function fireTouch(el: HTMLElement, type: 'touchstart' | 'touchend' | 'touchcancel', list: { clientX: number; clientY: number }[]): void {
  const touches = list.map((p, i) => ({ identifier: i, clientX: p.clientX, clientY: p.clientY })) as unknown as Touch[];
  const ev = new Event(type, { bubbles: true }) as TouchEvent;
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : touches });
  Object.defineProperty(ev, 'changedTouches', { value: touches });
  el.dispatchEvent(ev);
}

describe('BoardSwipeNavigatorDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let target: HTMLElement;
  let timeNow = 0;
  let perfSpy: jasmine.Spy;

  beforeEach(async () => {
    timeNow = 0;
    perfSpy = spyOn(performance, 'now').and.callFake(() => timeNow);
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    target = fixture.nativeElement.querySelector('div');
  });

  function swipe(fromX: number, fromY: number, toX: number, toY: number, dtMs: number) {
    timeNow = 0;
    fireTouch(target, 'touchstart', [{ clientX: fromX, clientY: fromY }]);
    timeNow = dtMs;
    fireTouch(target, 'touchend', [{ clientX: toX, clientY: toY }]);
  }

  it('emits swipeLeft when finger moves right→left past threshold', () => {
    swipe(200, 100, 130, 105, 200);
    expect(host.leftCount).toBe(1);
    expect(host.rightCount).toBe(0);
  });

  it('emits swipeRight when finger moves left→right past threshold', () => {
    swipe(100, 100, 170, 105, 200);
    expect(host.rightCount).toBe(1);
    expect(host.leftCount).toBe(0);
  });

  it('ignores swipes below the 60px horizontal threshold', () => {
    swipe(100, 100, 130, 100, 100);
    expect(host.leftCount).toBe(0);
    expect(host.rightCount).toBe(0);
  });

  it('ignores swipes with vertical drift >= 80px (treated as scroll)', () => {
    swipe(100, 100, 200, 200, 200);
    expect(host.leftCount + host.rightCount).toBe(0);
  });

  it('ignores swipes slower than 600ms', () => {
    swipe(100, 100, 200, 105, 700);
    expect(host.leftCount + host.rightCount).toBe(0);
  });

  it('refuses to track when disabled is true', () => {
    host.disabled = true;
    fixture.detectChanges();
    swipe(200, 100, 130, 105, 200);
    expect(host.leftCount + host.rightCount).toBe(0);
  });

  it('ignores multi-touch starts (pinch gesture should not be a swipe)', () => {
    timeNow = 0;
    fireTouch(target, 'touchstart', [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }]);
    timeNow = 200;
    fireTouch(target, 'touchend', [{ clientX: 30, clientY: 105 }]);
    expect(host.leftCount + host.rightCount).toBe(0);
  });

  it('clears tracking on touchcancel — subsequent touchend without start is no-op', () => {
    timeNow = 0;
    fireTouch(target, 'touchstart', [{ clientX: 200, clientY: 100 }]);
    fireTouch(target, 'touchcancel', []);
    timeNow = 200;
    fireTouch(target, 'touchend', [{ clientX: 130, clientY: 105 }]);
    expect(host.leftCount + host.rightCount).toBe(0);
  });

  afterEach(() => {
    perfSpy.and.callThrough();
  });
});
