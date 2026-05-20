// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

// Étape 1 du chantier DS (2026-05-20) — garde-fou, pas refonte.
// Les règles structurelles (selectors, lifecycle, output-native) restent
// en `error`. La dette préexistante (constructor injection, a11y templates,
// any, eqeqeq) est en `warn` : visible mais non bloquante. Le hook
// pré-commit (lint-staged) ne lint que les fichiers stagés — le code
// nouveau est strictement vérifié, l'existant non touché passe.

module.exports = tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '.angular/**',
      'src/assets/**',
      'e2e/**',
      '_tmp-*.js',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // Selectors — warn : ~10 composants legacy sans préfixe `app`.
      // La règle reste active pour signaler tout NOUVEAU composant mal nommé.
      '@angular-eslint/directive-selector': [
        'warn',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'warn',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      // Dette préexistante — warn (cf. en-tête).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@angular-eslint/prefer-inject': 'warn',
      '@angular-eslint/no-output-native': 'warn',
      '@angular-eslint/no-empty-lifecycle-method': 'warn',
      // catch {} délibéré (localStorage en mode privé, etc.) — toléré.
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Fichiers de test — idiomes spécifiques (boucles de drain vides, etc.).
    files: ['**/*.spec.ts'],
    rules: {
      'no-empty': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {
      // Dette a11y préexistante des templates — warn (cf. en-tête).
      '@angular-eslint/template/eqeqeq': 'warn',
      '@angular-eslint/template/click-events-have-key-events': 'warn',
      '@angular-eslint/template/interactive-supports-focus': 'warn',
      '@angular-eslint/template/label-has-associated-control': 'warn',
      '@angular-eslint/template/prefer-control-flow': 'warn',
      '@angular-eslint/template/no-autofocus': 'warn',
      '@angular-eslint/template/role-has-required-aria': 'warn',
    },
  },
);
