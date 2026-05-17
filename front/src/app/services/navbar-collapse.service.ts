import { computed, inject, Injectable, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NavbarCollapseService {
  private readonly EXPANDED_WIDTH = 260;
  private readonly COLLAPSED_WIDTH = 56;
  static readonly MOBILE_HEADER_HEIGHT = 48;

  private readonly breakpointObserver = inject(BreakpointObserver);

  readonly isMobile = toSignal(
    this.breakpointObserver
      .observe(['(max-width: 767px)', '(max-width: 1023px) and (max-height: 500px)'])
      .pipe(map(result => result.matches)),
    { initialValue: false }
  );

  readonly isMobilePortrait = toSignal(
    this.breakpointObserver
      .observe(['(max-width: 767px) and (orientation: portrait)'])
      .pipe(map(result => result.matches)),
    { initialValue: false }
  );

  private readonly _immersiveMode = signal(false);
  readonly immersiveMode = this._immersiveMode.asReadonly();

  /** Fullscreen-viewer mode — set by pages that own the entire viewport
   *  (replay viewer, duel page in future). Distinct from `immersiveMode` +
   *  `isLandscape` (which is the orientation-dependent "hide top chrome"
   *  computation). When true, the global `.dark-theme-content` should NOT
   *  reserve the mobile-header padding because the page already owns 100dvh
   *  via its own `:host { height: 100dvh }` rule. */
  private readonly _fullscreenViewer = signal(false);
  readonly fullscreenViewer = this._fullscreenViewer.asReadonly();

  readonly isLandscape = toSignal(
    this.breakpointObserver
      .observe(['(orientation: landscape)'])
      .pipe(map(result => result.matches)),
    { initialValue: false }
  );

  readonly shouldHideTopBar = computed(() => this.immersiveMode() && this.isLandscape());

  private readonly _navbarHidden = signal(false);
  readonly navbarHidden = this._navbarHidden.asReadonly();

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

  setImmersiveMode(value: boolean): void {
    this._immersiveMode.set(value);
  }

  setFullscreenViewer(value: boolean): void {
    this._fullscreenViewer.set(value);
  }

  setNavbarHidden(value: boolean): void {
    this._navbarHidden.set(value);
  }
}
