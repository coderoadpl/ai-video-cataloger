import path from 'node:path';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { it } from 'vitest';

import rule from './query-descriptors-only.js';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const webFile = path.join(process.cwd(), 'apps/web/src/App.tsx');
const featureFile = path.join(process.cwd(), 'apps/web/src/features/catalog/use-catalog.ts');
const at = (file) => (code) => ({ code, filename: file });
const web = at(webFile);
const feature = at(featureFile);

it('query-descriptors-only', () => {
  ruleTester.run('query-descriptors-only', rule, {
    valid: [
      feature("import { actions } from '../../api.js'; useQuery(actions.catalogLock);"),
      feature("import { actions } from '../../api.js'; useQuery(actions.scan({ folder: 'x' }));"),
      feature("import { actions } from '../../api.js'; useMutation(actions.setConfig);"),
      // Canonical descriptor source: the @core/client alias.
      web("import { healthQuery } from '@core/client/index.js'; useQuery(healthQuery);"),
      // Island core public seam / web composition (forward-compatible, Phase 6).
      feature("import { boardSelectors } from './core/index.js'; useQuery(boardSelectors.list);"),
      feature("import { boardSelectors } from './index.web.js'; useQuery(boardSelectors.list);"),
      feature("import { actions } from '../../api.js'; useMutation({ ...actions.setConfig, onSuccess() {} });"),
      feature("import { actions } from '../../api.js'; useQueries({ queries: [actions.catalogLock, actions.scan({ folder: 'x' })] });"),
      feature("import { actions } from '../../api.js'; const q = actions.catalogLock; useQuery(q);"),
      web('foo({ queryKey: [] });'),
    ],
    invalid: [
      {
        ...feature("useQuery({ queryKey: ['x'], queryFn: () => 1 });"),
        errors: [{ messageId: 'inlineObject' }],
      },
      {
        ...feature('useMutation({ mutationFn: () => 1 });'),
        errors: [{ messageId: 'inlineObject' }],
      },
      {
        ...feature('const local = { queryKey: [] }; useQuery(local);'),
        errors: [{ messageId: 'notImported' }],
      },
      {
        ...feature("import { actions } from '../../api.js'; useQuery(somethingElse);"),
        errors: [{ messageId: 'notImported' }],
      },
      {
        ...feature("useQueries({ queries: [{ queryKey: ['x'], queryFn() {} }] });"),
        errors: [{ messageId: 'inlineObject' }],
      },
      {
        // Look-alike evasion: a local module ending in `/api.js` is not the
        // canonical web binding once the path is resolved.
        ...feature("import { fake } from './helpers/api.js'; useQuery(fake);"),
        errors: [{ messageId: 'foreignModule' }],
      },
      {
        // Re-export evasion: a descriptor from a non-canonical module fails.
        ...feature("import { fake } from './descriptors-reexport.js'; useMutation(fake);"),
        errors: [{ messageId: 'foreignModule' }],
      },
    ],
  });
});
