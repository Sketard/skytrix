import { configDefaults, defineConfig } from 'vitest/config';

// `npm run build` compile les specs dans dist/ : sans cette exclusion, vitest
// rejoue chaque spec deux fois, dont la copie compilée.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
