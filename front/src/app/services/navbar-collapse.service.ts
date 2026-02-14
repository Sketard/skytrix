import { computed, inject, Injectable, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NavbarCollapseService {
  private readonly EXPANDED_WIDTH = 260;
  private readonly COLLAPSED_WIDTH = 32;
  static readonly MOBILE_HEADER_HEIGHT = 48;

  private readonly breakpointObserver = inject(BreakpointObserver);

  readonly isMobile = toSignal(
    this.breakpointObserver.observe('(max-width: 768px)').pipe(map(result => result.matches)),
    { initialValue: false }
  );

  readonly collapsed = signal(false);
  readonly drawerOpen = signal(false);
  readonly navbarWidth = computed(() => (this.collapsed() ? this.COLLAPSED_WIDTH : this.EXPANDED_WIDTH));

  toggle(): void {
    this.collapsed.update(v => !v);
  }

  setCollapsed(value: boolean): void {
    this.collapsed.set(value);
  }

  toggleDrawer(): void {
    this.drawerOpen.update(v => !v);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  openDrawer(): void {
    this.drawerOpen.set(true);
  }
}
