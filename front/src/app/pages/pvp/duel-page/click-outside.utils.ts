import { DestroyRef, ElementRef } from '@angular/core';

/**
 * Sets up a document-level click listener that fires `onClickOutside` when a click
 * occurs outside the given ElementRef. The listener is deferred by one microtask
 * (setTimeout) so that the current click event that opens the overlay does not
 * immediately trigger it. Cleanup is handled automatically via DestroyRef.
 *
 * @returns A teardown function that removes the listener early (before component destroy).
 */
export function setupClickOutsideListener(
  el: ElementRef,
  destroyRef: DestroyRef,
  onClickOutside: () => void,
): () => void {
  let listener: ((e: MouseEvent) => void) | null = null;
  const timeout = setTimeout(() => {
    listener = (event: MouseEvent) => {
      if (!el.nativeElement.contains(event.target as Node)) {
        onClickOutside();
      }
    };
    document.addEventListener('click', listener);
  });

  const teardown = (): void => {
    clearTimeout(timeout);
    if (listener) {
      document.removeEventListener('click', listener);
      listener = null;
    }
  };

  destroyRef.onDestroy(teardown);

  return teardown;
}
