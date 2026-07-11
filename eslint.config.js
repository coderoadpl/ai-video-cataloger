/**
 * ESLint flat config enforcing the GUI/CLI architecture invariants:
 *
 *   (A) Renderer accesses the CLI only via useCliCommand (I-1/I-4).
 *   (B) Renderer never imports the CLI engine (src/services, src/db) or main.
 *   (C) The CLI engine (src/) never imports Electron.
 *   (D) Deleted file:* IPC channels must not come back (I-3).
 *
 * Generic linting: @eslint/js + typescript-eslint recommended (non type-checked),
 * react + react-hooks recommended for the renderer.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** Selectors banning the deleted file:* IPC channel names (invariant I-3). */
const deletedChannelSelectors = [
  'file:readText',
  'file:readDir',
  'file:exists',
  'file:readAsDataUrl',
].map((channel) => ({
  selector: `Literal[value="${channel}"]`,
  message: `Channel "${channel}" was deleted: images via media://, data via CLI (invariant I-3).`,
}));

/** Selector banning direct electronAPI.cli access in the renderer (invariants I-1/I-4). */
const cliAccessSelector = {
  selector: 'MemberExpression[property.name="cli"][object.property.name="electronAPI"]',
  message: 'Access the CLI only via useCliCommand (invariant I-1/I-4).',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      '.cli-stage/**',
      '.e2e-worktrees/**',
      'electron/renderer/dist/**',
      'coverage/**',
      'scripts/ralph/**',
    ],
  },

  // ---- Base: JS + TS recommended (non type-checked) -------------------------
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Allow intentionally-unused values when prefixed with `_` (matches the
      // codebase convention, e.g. destructuring and catch clauses).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Node-flavoured code: CLI engine, tests, Electron main/preload, config files.
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'electron/main/**/*.ts', 'electron/preload/**/*.ts', '*.js', 'scripts/**/*.js', 'electron/renderer/*.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ---- Renderer: React + react-hooks ----------------------------------------
  {
    files: ['electron/renderer/src/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
      // TypeScript covers prop typing; PropTypes are not used in this codebase.
      'react/prop-types': 'off',
      // React Compiler preview rules (react-hooks v7). They flag idiomatic
      // pre-compiler patterns used here (load-on-open effects, latest-ref);
      // this codebase does not use the React Compiler.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/incompatible-library': 'off',
    },
  },

  // ---- no-explicit-any: hard error in production code ------------------------
  {
    files: ['src/**/*.ts', 'electron/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['test/**/*.ts', '**/*.test.{ts,tsx}', 'electron/renderer/src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ---- (C) CLI engine must stay independent from Electron --------------------
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'The CLI engine must not depend on Electron.',
            },
          ],
          patterns: [
            {
              group: ['electron/*'],
              message: 'The CLI engine must not depend on Electron.',
            },
          ],
        },
      ],
    },
  },

  // ---- (D) Deleted file:* channels must not come back (all of electron/) -----
  {
    files: ['electron/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...deletedChannelSelectors],
    },
  },

  // ---- (B) Renderer must not import the CLI engine or main -------------------
  {
    files: ['electron/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/src/services/*', '**/src/db/*'],
              message: 'The renderer must not import the CLI engine; talk to it via useCliCommand.',
            },
            {
              // `**/main/*` catches relative specifiers like `../../../main/foo`
              // (patterns match the raw import string, not the resolved path).
              group: ['**/electron/main/*', '**/main/*'],
              message: 'The renderer must not import the Electron main process.',
            },
          ],
        },
      ],
    },
  },

  // ---- (A) Renderer: CLI access only through useCliCommand -------------------
  // Includes the (D) selectors because a later `no-restricted-syntax` entry
  // replaces an earlier one for the same files.
  {
    files: ['electron/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', cliAccessSelector, ...deletedChannelSelectors],
    },
  },
  {
    files: [
      'electron/renderer/src/hooks/use-cli-command.ts',
      'electron/renderer/src/test/**/*.{ts,tsx}',
    ],
    rules: {
      // Rule (A) does not apply here (the one sanctioned access point + test
      // mocks), but the deleted-channel ban (D) still does.
      'no-restricted-syntax': ['error', ...deletedChannelSelectors],
    },
  }
);
