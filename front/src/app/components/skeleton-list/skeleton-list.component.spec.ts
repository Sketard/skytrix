import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SkeletonListComponent } from './skeleton-list.component';

@Component({
  standalone: true,
  imports: [SkeletonListComponent],
  template: `
    <app-skeleton-list [count]="count" [ariaLabel]="ariaLabel">
      <ng-template>
        <div class="item-mock">item</div>
      </ng-template>
    </app-skeleton-list>
  `,
})
class HostComponent {
  count = 3;
  ariaLabel = 'a11y.loading';
}

describe('SkeletonListComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function root(): HTMLElement {
    return fixture.nativeElement.querySelector('app-skeleton-list');
  }

  it('renders the projected template `count` times', () => {
    fixture.detectChanges();
    expect(root().querySelectorAll('.item-mock').length).toBe(3);
  });

  it('updates the rendered count when input changes', () => {
    fixture.detectChanges();
    host.count = 7;
    fixture.detectChanges();
    expect(root().querySelectorAll('.item-mock').length).toBe(7);
  });

  it('wires the a11y host attributes', () => {
    fixture.detectChanges();
    expect(root().getAttribute('role')).toBe('status');
    expect(root().getAttribute('aria-live')).toBe('polite');
    expect(root().getAttribute('aria-busy')).toBe('true');
    expect(root().getAttribute('aria-label')).toBe('a11y.loading');
  });
});
