import { computed, inject, Injectable, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

/** Seeds a `toSignal` with the live `matchMedia` result so the first render
 *  reflects the actual viewport instead of a hardcoded `false`. Without this,
 *  a cold load on a mobile device flashes the desktop layout for one tick
 *  before BreakpointObserver's first async emission lands. */
function matchesAny(queries: readonly string[]): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return queries.some(q => window.matchMedia(q).matches);
}

@Injectable({ providedIn: 'root' })
export class NavbarCollapseService {
  private readonly EXPANDED_WIDTH = 260;
  private readonly COLLAPSED_WIDTH = 56;
  static readonly MOBILE_HEADER_HEIGHT = 48;

  private readonly breakpointObserver = inject(BreakpointObserver);

  private static readonly MOBILE_QUERIES = [
    '(max-width: 767px)',
    '(max-width: 1023px) and (max-height: 500px)',
  ];
  private static readonly MOBILE_PORTRAIT_QUERIES = [
    '(max-width: 767px) and (orientation: portrait)',
  ];

  readonly isMobile = toSignal(
    this.breakpointObserver
      .observe(NavbarCollapseService.MOBILE_QUERIES)
      .pipe(map(result => result.matches)),
    { initialValue: matchesAny(NavbarCollapseService.MOBILE_QUERIES) }
  );

  readonly isMobilePortrait = toSignal(
    this.breakpointObserver
      .observe(NavbarCollapseService.MOBILE_PORTRAIT_QUERIES)
      .pipe(map(result => result.matches)),
    { initialValue: matchesAny(NavbarCollapseService.MOBILE_PORTRAIT_QUERIES) }
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
