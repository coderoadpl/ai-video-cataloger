import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const AS_BAN = {
  selector: 'TSAsExpression:not([typeAnnotation.typeName.name="const"])',
  message: 'Type assertions (`as`) are forbidden; parse or narrow instead. `as const` is allowed.',
};

/**
 * Layer boundaries (docs/architecture.md). `boundaries/element-types` denies
 * everything by default; each rule below is an explicit permission adapted from
 * the agentproofarch foundation minus auth/tenancy. dependency-cruiser
 * double-checks the same graph plus vendor bans in `npm run depcruise`.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'build/**',
      'release/**',
      'src/**',
      'electron/**',
      'test/**',
      'scripts/ralph/**',
    ],
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
              from: ['app-web'],
              allow: ['core-domain', 'core-contract', 'core-client', 'app-web'],
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
              from: [
                'core-domain',
                'core-contract',
                'core-server',
                'core-client',
                'adapters',
                'app-server',
                'app-web',
                'app-cli',
              ],
              disallow: ['electron'],
              message: 'Only apps/desktop (composition root + preload) may import electron',
            },
          ],
        },
      ],
    },
  },
);
