import js from '@eslint/js';
import tanstackQuery from '@tanstack/eslint-plugin-query';
import boundaries from 'eslint-plugin-boundaries';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactCompiler from 'eslint-plugin-react-compiler';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

import avc from './eslint-plugin-avc/index.js';

const AS_BAN = {
  selector: 'TSAsExpression:not([typeAnnotation.typeName.name="const"])',
  message: 'Type assertions (`as`) are forbidden; parse or narrow instead. `as const` is allowed.',
};

const RAW_COLOR_BAN = {
  selector: 'Literal[value=/(#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\()/i]',
  message: 'Raw color values are banned outside theme.ts; read colors from the MUI theme tokens.',
};

const REACT_API_BANS = [
  {
    selector: 'TSQualifiedName[left.name="React"][right.name=/^(FC|FunctionComponent)$/]',
    message: 'React.FC is banned: type props explicitly with `({ ... }: Props)` (React 19 conventions).',
  },
  {
    selector: 'CallExpression[callee.name="forwardRef"], CallExpression[callee.property.name="forwardRef"]',
    message: 'forwardRef is banned: `ref` is a normal prop in React 19.',
  },
  {
    selector: 'MemberExpression[property.name="defaultProps"]',
    message: 'Component defaultProps are banned: use default parameter values instead.',
  },
  {
    selector: 'JSXMemberExpression[property.name="Provider"]',
    message: '<Context.Provider> is banned: render <Context> directly (React 19).',
  },
];

const QUERY_HOOK_BANS = [
  {
    selector: 'CallExpression[typeArguments][callee.name=/^(useQuery|useQueries|useMutation)$/]',
    message: 'No explicit type arguments on useQuery/useQueries/useMutation: types flow from core/client descriptors.',
  },
  {
    selector: 'VariableDeclarator[id.type="ObjectPattern"][init.callee.name="useQueryClient"]',
    message: 'Do not destructure useQueryClient(): QueryClient methods depend on `this` binding.',
  },
  {
    selector: 'Property[key.name="defaultOptions"] Property[key.name="queryFn"]',
    message: 'No global defaultOptions.queries.queryFn: it bypasses the typed core/client.',
  },
];

const NEW_QUERY_CLIENT_BAN = {
  selector: 'NewExpression[callee.name="QueryClient"]',
  message: 'new QueryClient() lives only in apps/web/src/query-client.ts and the test harness.',
};

const QUERY_KEY_BAN = {
  selector: 'Property[key.name="queryKey"]',
  message: 'Inline query definitions are banned in apps/web: keys live in core/client descriptors.',
};

const VI_MOCK_BAN = {
  selector:
    'CallExpression[callee.object.name=/^(vi|jest)$/][callee.property.name="mock"][arguments.0.value=/@tanstack\\/react-query|core\\/client/]',
  message: 'Mocking @tanstack/react-query or core/client is banned: use a real QueryClient + MSW.',
};

const WEB_SYNTAX_BANS = [
  AS_BAN,
  ...REACT_API_BANS,
  ...QUERY_HOOK_BANS,
  NEW_QUERY_CLIENT_BAN,
  QUERY_KEY_BAN,
];

const NO_HTTP = 'No direct HTTP in apps/web: go through core/client descriptors via TanStack Query.';
const HTTP_GLOBALS = ['fetch', 'XMLHttpRequest', 'EventSource', 'WebSocket'].map((name) => ({
  name,
  message: NO_HTTP,
}));
const HTTP_IMPORT_BANS = ['axios', 'ky', 'got'].map((name) => ({ name, message: NO_HTTP }));

const STORAGE_MESSAGE =
  'localStorage/sessionStorage are banned outside a designated persistence helper.';
const STORAGE_GLOBALS = ['localStorage', 'sessionStorage'].map((name) => ({
  name,
  message: STORAGE_MESSAGE,
}));

const STATE_LIB_MESSAGE =
  'Global state libraries are banned: server state lives in TanStack Query, UI state stays local (React 19 / compiler).';
const STATE_LIB_BANS = ['redux', '@reduxjs/toolkit', 'zustand', 'jotai', 'mobx', 'valtio', 'recoil'].map(
  (name) => ({ name, message: STATE_LIB_MESSAGE }),
);

const CLIENT_CONSTRUCTION_BANS = [
  {
    name: '@core/client/index.js',
    importNames: ['createApiClient'],
    message:
      'createApiClient is bound once in apps/web/src/api.ts: import bound actions from api.ts, never construct a client.',
  },
];

const DEVTOOLS_BAN = [
  {
    name: '@tanstack/react-query-devtools',
    message: 'Query Devtools are wired only in main.tsx (dev-only composition root).',
  },
];

const MUI_SKELETON_COMPONENTS = ['Container', 'AppBar', 'Drawer', 'Toolbar'];
const MUI_SKELETON_MESSAGE =
  'Container/AppBar/Drawer/Toolbar shape a page: define the skeleton in apps/web/src/components/layout and pass content through slots (ADR-0004 §d).';
const MUI_SKELETON_BAN = {
  name: '@mui/material',
  importNames: MUI_SKELETON_COMPONENTS,
  message: MUI_SKELETON_MESSAGE,
};
const MUI_SKELETON_DEEP_BAN = {
  group: MUI_SKELETON_COMPONENTS.map((name) => `@mui/material/${name}`),
  message: MUI_SKELETON_MESSAGE,
};

const QUERY_CLIENT_SINGLETON_PATTERN = {
  regex: 'query-client\\.js$',
  message:
    'Do not import the QueryClient singleton: reach it via useQueryClient(). Only main.tsx wires it.',
};

// Island cores (features/*/core) are portable, DOM-free modules: they may not
// reach out of their own core directory. Every parent-relative specifier (`../…`)
// escapes the core — api.ts, i18n, a sibling feature, any apps/web path — so the
// whole class is banned; shared contracts arrive through the `@core/*` alias and
// the bound descriptors are INJECTED in features/<name>/index.web.ts (ADR-0005
// §Pure-TS cores). Mirrored by the depcruise `island-core-is-portable` rule.
const ISLAND_CORE_PORTABILITY_MESSAGE =
  'Island cores are portable and DOM-free: no parent-relative import — not api.ts, i18n, a sibling feature, or any apps/web path outside this core. Inject bound descriptors in features/<name>/index.web.ts and reach shared contracts via the @core/* alias (ADR-0005 §Pure-TS cores).';
const ISLAND_CORE_PORTABILITY_PATTERN = {
  group: ['../*', '../**'],
  message: ISLAND_CORE_PORTABILITY_MESSAGE,
};

const ISLAND_CORE_FRAMEWORK_MESSAGE =
  'Island cores are pure TypeScript: no React, MUI, TanStack or i18n. Expose typed dictionary keys the web binding translates (ADR-0005 §Pure-TS cores).';
const ISLAND_CORE_FRAMEWORK_BANS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@mui/material',
  '@mui/icons-material',
  '@emotion/react',
  '@emotion/styled',
  '@tanstack/react-query',
  '@tanstack/react-router',
].map((name) => ({ name, message: ISLAND_CORE_FRAMEWORK_MESSAGE }));

const ISLAND_CORE_DOM_MESSAGE =
  'Island cores are DOM-free: no window/document. Keep DOM access in the web binding (ADR-0005 §Pure-TS cores).';
const ISLAND_CORE_DOM_GLOBALS = ['window', 'document'].map((name) => ({
  name,
  message: ISLAND_CORE_DOM_MESSAGE,
}));

/**
 * Layer boundaries (docs/architecture.md) plus the renderer's inner boundaries
 * (frontend-lint-plan Phases 1–3). `boundaries/element-types` denies everything
 * by default; each rule is an explicit permission adapted from the
 * agentproofarch foundation minus auth/tenancy. dependency-cruiser
 * double-checks the same graph plus vendor bans in `pnpm run depcruise`.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'build/**',
      'release/**',
      'test/**',
      'visual/**',
      'scripts/ralph/**',
      'landing/**',
      '.claude/**',
      '.cli-stage/**',
    ],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { console: 'readonly', process: 'readonly' },
    },
    rules: js.configs.recommended.rules,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { module: 'readonly', require: 'readonly', process: 'readonly' },
    },
    rules: js.configs.recommended.rules,
  },
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { boundaries },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'boundaries/elements': [
        { type: 'core-domain', pattern: 'core/domain/**', mode: 'full' },
        { type: 'core-contract', pattern: 'core/contract/**', mode: 'full' },
        { type: 'core-server', pattern: 'core/server/**', mode: 'full' },
        { type: 'core-client', pattern: 'core/client/**', mode: 'full' },
        { type: 'adapters', pattern: 'adapters/**', mode: 'full' },
        { type: 'app-server', pattern: 'apps/server/**', mode: 'full' },
        { type: 'app-desktop', pattern: 'apps/desktop/**', mode: 'full' },
        { type: 'web-main', pattern: 'apps/web/src/main.tsx', mode: 'full' },
        { type: 'web-shell', pattern: 'apps/web/src/AppLayout*', mode: 'full' },
        { type: 'web-gallery', pattern: 'apps/web/src/gallery/**', mode: 'full' },
        { type: 'web-visual', pattern: 'apps/web/src/visual/**', mode: 'full' },
        { type: 'web-api', pattern: 'apps/web/src/api.ts', mode: 'full' },
        { type: 'web-routes', pattern: 'apps/web/src/routes/**', mode: 'full' },
        {
          type: 'web-island-core',
          pattern: 'apps/web/src/features/(*)/core/**',
          mode: 'full',
          capture: ['feature'],
        },
        {
          type: 'web-features',
          pattern: 'apps/web/src/features/(*)/**',
          mode: 'full',
          capture: ['feature'],
        },
        { type: 'web-layout', pattern: 'apps/web/src/components/layout/**', mode: 'full' },
        { type: 'web-ui', pattern: 'apps/web/src/components/ui/**', mode: 'full' },
        { type: 'web-lib', pattern: 'apps/web/src/lib/**', mode: 'full' },
        { type: 'web-test', pattern: 'apps/web/src/test/**', mode: 'full' },
        { type: 'web-theme', pattern: 'apps/web/src/theme*', mode: 'full' },
        { type: 'web-i18n', pattern: 'apps/web/src/i18n/**', mode: 'full' },
        { type: 'app-web', pattern: 'apps/web/**', mode: 'full' },
        { type: 'app-cli', pattern: 'apps/cli/**', mode: 'full' },
        { type: 'config', pattern: '*.config.ts', mode: 'full' },
      ],
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-restricted-syntax': ['error', AS_BAN],
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message: '${file.type} is not allowed to import ${dependency.type} (see docs/architecture.md)',
          rules: [
            { from: ['core-domain'], allow: ['core-domain'] },
            { from: ['core-contract'], allow: ['core-domain', 'core-contract'] },
            { from: ['core-server'], allow: ['core-domain', 'core-server'] },
            { from: ['core-client'], allow: ['core-domain', 'core-contract', 'core-client'] },
            {
              from: ['adapters'],
              allow: ['core-domain', 'core-server', 'core-client', 'adapters'],
            },
            {
              from: ['app-server'],
              allow: ['core-domain', 'core-contract', 'core-server', 'adapters', 'app-server'],
            },
            {
              from: ['app-cli'],
              allow: ['core-domain', 'core-contract', 'core-client', 'app-server', 'app-cli'],
            },
            {
              from: ['app-desktop'],
              allow: [
                'core-domain',
                'core-contract',
                'core-client',
                'adapters',
                'app-server',
                'app-desktop',
              ],
            },
            {
              from: ['web-main'],
              allow: [
                'web-main',
                'web-shell',
                'web-api',
                'web-routes',
                'web-features',
                'web-layout',
                'web-ui',
                'web-lib',
                'web-theme',
                'web-i18n',
                'app-web',
                'core-domain',
                'core-contract',
                'core-client',
              ],
            },
            {
              from: ['web-shell'],
              allow: [
                'web-shell',
                'web-features',
                'web-layout',
                'web-ui',
                'web-lib',
                'web-theme',
                'web-i18n',
                'web-test',
              ],
            },
            {
              from: ['web-gallery'],
              allow: [
                'web-gallery',
                'web-api',
                'web-routes',
                'web-features',
                'web-layout',
                'web-ui',
                'web-lib',
                'web-theme',
                'web-i18n',
                'app-web',
                'core-domain',
                'core-contract',
                'core-client',
              ],
            },
            {
              from: ['web-visual'],
              allow: [
                'web-visual',
                'web-features',
                'web-layout',
                'web-ui',
                'web-lib',
                'web-theme',
                'web-i18n',
                'app-web',
              ],
            },
            {
              from: ['web-api'],
              allow: ['web-api', 'core-domain', 'core-contract', 'core-client'],
            },
            {
              from: ['web-routes'],
              allow: ['web-routes', 'web-shell', 'web-features', 'web-layout', 'web-ui', 'web-lib'],
            },
            {
              from: ['web-features'],
              allow: [
                ['web-features', { feature: '${from.feature}' }],
                ['web-island-core', { feature: '${from.feature}' }],
                'web-api',
                'web-layout',
                'web-ui',
                'web-lib',
                'web-theme',
                'web-i18n',
                'web-test',
                'core-domain',
                'core-contract',
                'core-client',
              ],
            },
            {
              from: ['web-island-core'],
              allow: [
                ['web-island-core', { feature: '${from.feature}' }],
                'core-domain',
                'core-contract',
                'core-client',
              ],
            },
            {
              from: ['web-i18n'],
              allow: [
                'web-i18n',
                'web-api',
                'web-lib',
                'web-test',
                'core-domain',
                'core-contract',
                'core-client',
              ],
            },
            {
              from: ['web-layout'],
              allow: ['web-layout', 'web-ui', 'web-lib', 'web-theme'],
            },
            {
              from: ['web-ui'],
              allow: ['web-ui', 'web-lib', 'web-theme', 'web-i18n', 'web-test'],
            },
            {
              from: ['web-lib'],
              allow: ['web-lib'],
            },
            {
              from: ['web-theme'],
              allow: ['web-theme'],
            },
            {
              from: ['web-test'],
              allow: ['web-test'],
            },
            {
              from: ['app-web'],
              allow: ['app-web', 'core-domain', 'core-contract', 'core-client'],
            },
          ],
        },
      ],
      'boundaries/external': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: ['core-domain', 'core-contract', 'core-server'],
              disallow: ['hono', 'drizzle-orm', 'commander', 'react', 'react-dom', 'electron'],
              message: 'Core stays pure TypeScript: no frameworks, servers or drivers',
            },
            {
              from: ['core-client'],
              disallow: ['hono', 'drizzle-orm', 'commander', 'react', 'react-dom', 'electron'],
              message: 'core/client is framework-agnostic',
            },
            {
              from: ['web-lib'],
              disallow: ['react', 'react-dom'],
              message: 'web-lib is pure TypeScript: no react (frontend-lint-plan Phase 2)',
            },
            {
              from: ['web-ui'],
              disallow: ['@tanstack/react-query', '@tanstack/react-router'],
              message:
                'components/ui is presentational: no TanStack Query/Router (frontend-lint-plan Phase 2)',
            },
            {
              from: ['web-layout'],
              disallow: ['@tanstack/react-query', '@tanstack/react-router'],
              message:
                'components/layout holds page skeletons: structure only, no server state (ADR-0004)',
            },
            {
              from: [
                'core-domain',
                'core-contract',
                'core-server',
                'core-client',
                'adapters',
                'app-server',
                'app-web',
                'web-main',
                'web-shell',
                'web-visual',
                'web-api',
                'web-routes',
                'web-island-core',
                'web-features',
                'web-layout',
                'web-ui',
                'web-lib',
                'web-test',
                'web-theme',
                'app-cli',
              ],
              disallow: ['electron'],
              message: 'Only apps/desktop (composition root + preload) may import electron',
            },
            {
              from: ['web-island-core'],
              disallow: [
                'react',
                'react-dom',
                '@mui/material',
                '@mui/icons-material',
                '@tanstack/react-query',
                '@tanstack/react-router',
              ],
              message:
                'Island cores are pure TypeScript: no React, MUI or TanStack (ADR-0005 §Pure-TS cores)',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      '@tanstack/query': tanstackQuery,
      avc,
      'jsx-a11y': jsxA11y,
      react,
      'react-compiler': reactCompiler,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      '@tanstack/query/exhaustive-deps': 'error',
      '@tanstack/query/no-rest-destructuring': 'error',
      '@tanstack/query/stable-query-client': 'error',
      'avc/query-descriptors-only': 'error',
      'react-compiler/react-compiler': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react/no-unstable-nested-components': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-globals': ['error', ...HTTP_GLOBALS, ...STORAGE_GLOBALS],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...HTTP_IMPORT_BANS,
            ...STATE_LIB_BANS,
            ...CLIENT_CONSTRUCTION_BANS,
            ...DEVTOOLS_BAN,
            MUI_SKELETON_BAN,
          ],
          patterns: [QUERY_CLIENT_SINGLETON_PATTERN, MUI_SKELETON_DEEP_BAN],
        },
      ],
      'no-restricted-syntax': ['error', ...WEB_SYNTAX_BANS, RAW_COLOR_BAN],
    },
  },
  {
    files: ['apps/web/src/components/layout/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...HTTP_IMPORT_BANS, ...STATE_LIB_BANS, ...CLIENT_CONSTRUCTION_BANS, ...DEVTOOLS_BAN],
          patterns: [QUERY_CLIENT_SINGLETON_PATTERN],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/theme.ts', 'apps/web/src/theme-mode.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...WEB_SYNTAX_BANS],
    },
  },
  {
    files: ['apps/web/src/query-client.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        AS_BAN,
        ...REACT_API_BANS,
        ...QUERY_HOOK_BANS,
        QUERY_KEY_BAN,
        RAW_COLOR_BAN,
      ],
    },
  },
  {
    files: ['apps/web/src/api.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...HTTP_IMPORT_BANS, ...STATE_LIB_BANS, ...DEVTOOLS_BAN],
          patterns: [QUERY_CLIENT_SINGLETON_PATTERN],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/main.tsx', 'apps/web/src/gallery/main.tsx', 'apps/web/src/visual/main.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...HTTP_IMPORT_BANS,
            ...STATE_LIB_BANS,
            ...CLIENT_CONSTRUCTION_BANS,
            MUI_SKELETON_BAN,
          ],
          patterns: [MUI_SKELETON_DEEP_BAN],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/features/*/core/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/features/*/core/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', ...HTTP_GLOBALS, ...STORAGE_GLOBALS, ...ISLAND_CORE_DOM_GLOBALS],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...HTTP_IMPORT_BANS,
            ...STATE_LIB_BANS,
            ...CLIENT_CONSTRUCTION_BANS,
            ...DEVTOOLS_BAN,
            ...ISLAND_CORE_FRAMEWORK_BANS,
          ],
          patterns: [QUERY_CLIENT_SINGLETON_PATTERN, ISLAND_CORE_PORTABILITY_PATTERN],
        },
      ],
    },
  },
  {
    // An island's inbound event contract lives in core/events.ts; every event is
    // named for what happened (intent suffix), never an imperative command.
    // Forward-only: rung-1 cores expose selectors/typed keys, no inbound event
    // union yet; a core/events.ts arrives when a core graduates to rung 2.
    files: ['apps/web/src/features/*/core/events.ts'],
    rules: {
      'avc/event-suffix-taxonomy': 'error',
    },
  },
  {
    files: ['apps/web/src/test/**/*.{ts,tsx}', 'apps/web/**/*.test.{ts,tsx}'],
    rules: {
      'avc/query-descriptors-only': 'off',
      'no-restricted-syntax': ['error', AS_BAN, ...REACT_API_BANS, ...QUERY_HOOK_BANS, VI_MOCK_BAN],
    },
  },
);
