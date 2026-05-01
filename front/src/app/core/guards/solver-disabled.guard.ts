import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const solverDisabledGuard: CanActivateFn = () => {
  const router = inject(Router);
  router.navigate(['/decks']);
  return false;
};
