import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { ESLint, type Linter } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

const token = `__avc_probe_${process.pid}_${Date.now()}__`;
const coreDir = join('core', 'domain', token);
const featureDir = join('apps', 'web', 'src', 'features', token);
const uiDir = join('apps', 'web', 'src', 'components', 'ui', token);
const layoutDir = join('apps', 'web', 'src', 'components', 'layout', token);
const galleryDir = join('apps', 'web', 'src', 'gallery', token);
const visualDir = join('apps', 'web', 'src', 'visual', token);
const cliDir = join('apps', 'cli', token);
const dcDir = join('core', 'domain', `${token}_dc`);

const SWEEP_BASES = [
  join(repoRoot, 'core', 'domain'),
  join(repoRoot, 'apps', 'web', 'src', 'features'),
  join(repoRoot, 'apps', 'web', 'src', 'components', 'ui'),
  join(repoRoot, 'apps', 'web', 'src', 'components', 'layout'),
  join(repoRoot, 'apps', 'web', 'src', 'gallery'),
  join(repoRoot, 'apps', 'web', 'src', 'visual'),
  join(repoRoot, 'apps', 'cli'),
];

const sweep = (): void => {
  for (const base of SWEEP_BASES) {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('__avc_probe_')) {
        rmSync(join(base, entry.name), { recursive: true, force: true });
      }
    }
  }
};

interface Fixture {
  rel: string;
  content: string;
}

const fixtures = {
  as: {
    rel: join(coreDir, 'as-probe.ts'),
    content: 'export const forbidden = 1 as number;\n',
  },
  explicitAny: {
    rel: join(coreDir, 'any-probe.ts'),
    content: 'export const identity = (value: any) => value;\n',
  },
  configDescriptorExhaustiveness: {
    rel: join(coreDir, 'config-descriptor-exhaustiveness-probe.ts'),
    content:
      "import type { ConfigDescriptor } from '../config-descriptor.js';\n" +
      "export const label = (family: ConfigDescriptor['family']): string => {\n" +
      '  switch (family) {\n' +
      "    case 'api': return 'api';\n" +
      "    case 'harness': return 'harness';\n" +
      "    case 'local': return 'local';\n" +
      "    case 'gemini-native': return 'gemini-native';\n" +
      '  }\n' +
      '};\n',
  },
  coreImportsAdapters: {
    rel: join(coreDir, 'adapters-probe.ts'),
    content: "import '../../../adapters/db/index.js';\n",
  },
  cliImportsServer: {
    rel: join(cliDir, 'server-probe.ts'),
    content: "import '../../../core/server/index.js';\n",
  },
  restrictedImport: {
    rel: join(featureDir, 'axios-probe.ts'),
    content: "import 'axios';\n",
  },
  fetchGlobal: {
    rel: join(featureDir, 'fetch-probe.ts'),
    content: "export const load = () => fetch('/videos');\n",
  },
  electronImport: {
    rel: join(featureDir, 'electron-probe.ts'),
    content: "import 'electron';\n",
  },
  crossFeature: {
    rel: join(featureDir, 'cross-probe.ts'),
    content: "import '../catalog/use-catalog.js';\n",
  },
  queryHook: {
    rel: join(featureDir, 'query-probe.tsx'),
    content:
      "import { useQuery } from '@tanstack/react-query';\n" +
      'export const probe = () => useQuery<number>(undefined);\n',
  },
  rawColor: {
    rel: join(featureDir, 'color-probe.tsx'),
    content:
      "import { Box } from '@mui/material';\n" +
      "export const probe = () => <Box sx={{ color: '#ff0000' }} />;\n",
  },
  uiImportsI18n: {
    rel: join(uiDir, 'i18n-probe.ts'),
    content: "import '../../../i18n/dictionary.js';\n",
  },
  layoutImportsFeature: {
    rel: join(layoutDir, 'feature-probe.ts'),
    content: "import '../../../features/catalog/use-catalog.js';\n",
  },
  muiSkeletonOutsideLayout: {
    rel: join(featureDir, 'container-probe.tsx'),
    content:
      "import { Container } from '@mui/material';\n" +
      'export const probe = () => <Container />;\n',
  },
  muiSkeletonInsideLayout: {
    rel: join(layoutDir, 'container-probe.tsx'),
    content:
      "import { Container } from '@mui/material';\n" +
      'export const probe = () => <Container />;\n',
  },
  galleryImportsFeature: {
    rel: join(galleryDir, 'feature-probe.ts'),
    content: "import '../../features/catalog/use-catalog.js';\n",
  },
  visualImportsApi: {
    rel: join(visualDir, 'api-probe.ts'),
    content: "import '../../api.js';\n",
  },
  visualImportsLayout: {
    rel: join(visualDir, 'layout-probe.ts'),
    content: "import '../../components/layout/AppShell.js';\n",
  },
  queryDescriptorsInline: {
    rel: join(featureDir, 'descriptors-probe.tsx'),
    content:
      "import { useQuery } from '@tanstack/react-query';\n" +
      "export const probe = () => useQuery({ queryKey: ['avc-probe'], queryFn: () => 1 });\n",
  },
  queryDescriptorsValid: {
    rel: join(featureDir, 'descriptors-ok-probe.tsx'),
    content:
      "import { useQuery } from '@tanstack/react-query';\n" +
      "import { actions } from '../../api.js';\n" +
      'export const probe = () => useQuery(actions.catalogLock);\n',
  },
  eventTaxonomy: {
    rel: join(featureDir, 'core', 'events.ts'),
    content: "export type ProbeEvents = { type: 'deleteThing' } | { type: 'thingRemoved' };\n",
  },
  islandCoreReact: {
    rel: join(featureDir, 'core', 'react-probe.ts'),
    content: "import 'react';\nexport const probe = 1;\n",
  },
  islandCoreI18n: {
    rel: join(featureDir, 'core', 'i18n-probe.ts'),
    content: "import '../../../i18n/dictionary.js';\nexport const probe = 1;\n",
  },
  islandCoreIndex: {
    rel: join(featureDir, 'core', 'index.ts'),
    content: 'export const thing = 1;\n',
  },
  islandBindingImportsCore: {
    rel: join(featureDir, 'index.web.ts'),
    content: "import { thing } from './core/index.js';\nexport const probe = thing;\n",
  },
} satisfies Record<string, Fixture>;

const dcFixture: Fixture = {
  rel: join(dcDir, 'react-probe.ts'),
  content: "import 'react';\n",
};

interface EslintMessage {
  ruleId: string | null;
  message: string;
}
interface EslintResult {
  filePath: string;
  messages: EslintMessage[];
}

const messagesByFixture = new Map<string, EslintMessage[]>();
const depcruiseRules = new Set<string>();
const islandDepcruiseRules = new Set<string>();
const layoutDepcruiseRules = new Set<string>();

const write = (rel: string, content: string): string => {
  const abs = join(repoRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return abs;
};

const messagesFor = (fixture: Fixture): EslintMessage[] => messagesByFixture.get(fixture.rel) ?? [];
const findMessage = (fixture: Fixture, ruleId: string): EslintMessage | undefined =>
  messagesFor(fixture).find((message) => message.ruleId === ruleId);

beforeAll(() => {
  sweep();

  const allFixtures = Object.values(fixtures);
  const eslintTargets = allFixtures.map((fixture) => write(fixture.rel, fixture.content));
  write(dcFixture.rel, dcFixture.content);

  const eslintBin = join(repoRoot, 'node_modules', '.bin', 'eslint');
  const eslintRun = spawnSync(eslintBin, ['--format', 'json', ...eslintTargets], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const eslintResults: EslintResult[] = JSON.parse(eslintRun.stdout);
  for (const result of eslintResults) {
    for (const fixture of allFixtures) {
      if (result.filePath === join(repoRoot, fixture.rel)) {
        messagesByFixture.set(fixture.rel, result.messages);
      }
    }
  }

  const depBin = join(repoRoot, 'node_modules', '.bin', 'depcruise');
  const depRun = spawnSync(depBin, ['--output-type', 'json', dcDir], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const depReport: { summary: { violations: { rule: { name: string } }[] } } = JSON.parse(depRun.stdout);
  for (const violation of depReport.summary.violations) depcruiseRules.add(violation.rule.name);

  const islandRun = spawnSync(depBin, ['--output-type', 'json', join(featureDir, 'core')], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const islandReport: { summary: { violations: { rule: { name: string } }[] } } = JSON.parse(islandRun.stdout);
  for (const violation of islandReport.summary.violations) islandDepcruiseRules.add(violation.rule.name);

  const layoutRun = spawnSync(depBin, ['--output-type', 'json', layoutDir], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const layoutReport: { summary: { violations: { rule: { name: string } }[] } } = JSON.parse(layoutRun.stdout);
  for (const violation of layoutReport.summary.violations) layoutDepcruiseRules.add(violation.rule.name);
});

afterAll(() => {
  sweep();
});

describe('ESLint gate still rejects violations', () => {
  it('bans `as` type assertions (AS_BAN via no-restricted-syntax)', () => {
    const message = findMessage(fixtures.as, 'no-restricted-syntax');
    expect(message).toBeDefined();
    expect(message?.message).toContain('Type assertions');
  });

  it('bans `any` (no-explicit-any)', () => {
    expect(findMessage(fixtures.explicitAny, '@typescript-eslint/no-explicit-any')).toBeDefined();
  });

  it('rejects a config descriptor family switch that omits translation', () => {
    const message = findMessage(
      fixtures.configDescriptorExhaustiveness,
      '@typescript-eslint/switch-exhaustiveness-check',
    );
    expect(message).toBeDefined();
    expect(message?.message).toContain('translation');
  });

  it('bans core importing adapters (boundaries/element-types)', () => {
    const message = findMessage(fixtures.coreImportsAdapters, 'boundaries/element-types');
    expect(message).toBeDefined();
    expect(message?.message).toContain('core-domain');
  });

  it('bans the CLI importing core/server, keeping it an over-HTTP composition root', () => {
    const message = findMessage(fixtures.cliImportsServer, 'boundaries/element-types');
    expect(message).toBeDefined();
    expect(message?.message).toContain('app-cli');
  });

  it('bans restricted HTTP imports (axios) in the renderer', () => {
    expect(findMessage(fixtures.restrictedImport, 'no-restricted-imports')).toBeDefined();
  });

  it('bans the fetch global in the renderer (no-restricted-globals)', () => {
    expect(findMessage(fixtures.fetchGlobal, 'no-restricted-globals')).toBeDefined();
  });

  it('bans electron in the renderer (boundaries/external)', () => {
    const message = findMessage(fixtures.electronImport, 'boundaries/external');
    expect(message).toBeDefined();
    expect(message?.message).toContain('desktop');
  });

  it('bans cross-feature imports (web-features are islands)', () => {
    const message = findMessage(fixtures.crossFeature, 'boundaries/element-types');
    expect(message).toBeDefined();
    expect(message?.message).toContain('web-features');
  });

  it('bans explicit type arguments on useQuery in a feature (query-hook ban)', () => {
    const message = findMessage(fixtures.queryHook, 'no-restricted-syntax');
    expect(message).toBeDefined();
    expect(message?.message).toContain('No explicit type arguments');
  });

  it('bans raw color literals in the renderer (RAW_COLOR_BAN)', () => {
    const message = findMessage(fixtures.rawColor, 'no-restricted-syntax');
    expect(message).toBeDefined();
    expect(message?.message).toContain('Raw color');
  });

  it('bans inline query descriptors in a feature (avc/query-descriptors-only)', () => {
    const message = findMessage(fixtures.queryDescriptorsInline, 'avc/query-descriptors-only');
    expect(message).toBeDefined();
    expect(message?.message).toContain('imported action descriptor');
  });

  it('bans imperative event names in core/events.ts (avc/event-suffix-taxonomy)', () => {
    const message = findMessage(fixtures.eventTaxonomy, 'avc/event-suffix-taxonomy');
    expect(message).toBeDefined();
    expect(message?.message).toContain('intent suffix');
  });

  it('bans react imports in an island core (no-restricted-imports, pure TypeScript)', () => {
    const message = findMessage(fixtures.islandCoreReact, 'no-restricted-imports');
    expect(message).toBeDefined();
    expect(message?.message).toContain('pure TypeScript');
  });

  it('bans reaching i18n from an island core (no-restricted-imports, portable)', () => {
    const message = findMessage(fixtures.islandCoreI18n, 'no-restricted-imports');
    expect(message).toBeDefined();
    expect(message?.message).toContain('portable');
  });

  it('bans a layout skeleton importing a feature (boundaries/element-types)', () => {
    const message = findMessage(fixtures.layoutImportsFeature, 'boundaries/element-types');
    expect(message).toBeDefined();
    expect(message?.message).toContain('web-layout');
  });

  it('bans the visual harness reaching the bound API client (boundaries/element-types)', () => {
    const message = findMessage(fixtures.visualImportsApi, 'boundaries/element-types');
    expect(message).toBeDefined();
    expect(message?.message).toContain('web-visual');
  });

  it('bans skeleton MUI components outside components/layout (MUI_SKELETON_BAN)', () => {
    const message = findMessage(fixtures.muiSkeletonOutsideLayout, 'no-restricted-imports');
    expect(message).toBeDefined();
    expect(message?.message).toContain('components/layout');
  });
});

describe('ESLint gate keeps app-owned grants (positive probes)', () => {
  it('lets a components/ui file import i18n/ (web-i18n grant survives)', () => {
    expect(findMessage(fixtures.uiImportsI18n, 'boundaries/element-types')).toBeUndefined();
  });

  it('lets the gallery composition root import a feature (web-gallery second root survives)', () => {
    expect(findMessage(fixtures.galleryImportsFeature, 'boundaries/element-types')).toBeUndefined();
  });

  it('lets the visual harness render a layout skeleton (ADR-0005 §b harness grant)', () => {
    expect(findMessage(fixtures.visualImportsLayout, 'boundaries/element-types')).toBeUndefined();
  });

  it('lets a feature spread an imported descriptor into a query hook (avc rule does not over-fire)', () => {
    expect(findMessage(fixtures.queryDescriptorsValid, 'avc/query-descriptors-only')).toBeUndefined();
  });

  it('lets components/layout own the skeleton MUI components the rest of the app may not', () => {
    expect(findMessage(fixtures.muiSkeletonInsideLayout, 'no-restricted-imports')).toBeUndefined();
  });

  it('lets a web binding (index.web.ts) import its own island core (seam is lawful)', () => {
    expect(findMessage(fixtures.islandBindingImportsCore, 'boundaries/element-types')).toBeUndefined();
    expect(findMessage(fixtures.islandBindingImportsCore, 'no-restricted-imports')).toBeUndefined();
  });
});

describe('dependency-cruiser gate still rejects violations', () => {
  it('behavioral: react imported into core fires no-frameworks-in-core', () => {
    expect(depcruiseRules.has('no-frameworks-in-core')).toBe(true);
  });

  it('behavioral: react in an island core fires island-core-no-frameworks', () => {
    expect(islandDepcruiseRules.has('island-core-no-frameworks')).toBe(true);
  });

  it('behavioral: an island core reaching i18n fires island-core-is-portable', () => {
    expect(islandDepcruiseRules.has('island-core-is-portable')).toBe(true);
  });

  it('behavioral: a layout reaching a feature fires web-layouts-are-structure-only', () => {
    expect(layoutDepcruiseRules.has('web-layouts-are-structure-only')).toBe(true);
  });

  it('structural: every guarded rule is present with severity error', () => {
    const depConfig: { forbidden: { name: string; severity: string }[] } = require(
      join(repoRoot, '.dependency-cruiser.cjs'),
    );
    const byName = new Map(depConfig.forbidden.map((rule) => [rule.name, rule.severity]));
    for (const name of [
      'no-circular',
      'core-domain-depends-on-nothing',
      'core-contract-only-domain',
      'core-server-pure',
      'core-client-never-server-side',
      'adapters-never-import-apps',
      'web-never-server-side',
      'web-features-are-islands',
      'web-layouts-are-structure-only',
      'web-ui-presentational',
      'web-lib-no-react',
      'cli-only-composes-server',
      'desktop-only-composes',
      'no-frameworks-in-core',
      'island-core-is-portable',
      'island-core-no-frameworks',
      'electron-only-in-desktop',
    ]) {
      expect(byName.get(name)).toBe('error');
    }
  });
});

describe('custom boundary rules stay registered as errors', () => {
  const severityOf = (entry: Linter.RuleEntry | undefined): Linter.RuleSeverity | undefined => {
    if (entry === undefined) return undefined;
    if (Array.isArray(entry)) return entry[0];
    return entry;
  };

  it('no-restricted-syntax and boundaries/element-types are errors on feature files', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const config: Linter.Config = await eslint.calculateConfigForFile(
      join('apps', 'web', 'src', 'features', 'catalog', 'CatalogSidebar.tsx'),
    );
    const rules = config.rules ?? {};
    expect(severityOf(rules['no-restricted-syntax'])).toBe(2);
    expect(severityOf(rules['boundaries/element-types'])).toBe(2);
  });
});
