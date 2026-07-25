import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { readmeScriptProblems } from './doc-lint-readme.js';

const scriptsDir = import.meta.dirname;
const repoRoot = join(scriptsDir, '..');
const require = createRequire(import.meta.url);

const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');
const has = (rel: string, needle: string | RegExp): boolean => {
  const text = read(rel);
  return typeof needle === 'string' ? text.includes(needle) : needle.test(text);
};

const LEAKED_DELIMITERS = ['</content>', '</invoke>', '</parameter>'];

const eslintConfig = 'eslint.config.js';
const depcruiseConfig = '.dependency-cruiser.cjs';
const eslintSource = read(eslintConfig);
const depcruiseModule: { forbidden: ReadonlyArray<{ name: string }> } = require(
  join(repoRoot, depcruiseConfig),
);
const depcruiseRuleNames = new Set(depcruiseModule.forbidden.map((rule) => rule.name));

type ConfigTarget = 'eslint' | 'depcruise';

const configHasId = (id: string, target: ConfigTarget): boolean =>
  target === 'eslint' ? eslintSource.includes(id) : depcruiseRuleNames.has(id);

/**
 * Enforcers the architecture prose relies on. `doc` is a human reference, not
 * scanned; the gate is that the enforcer id still exists in its config, so a
 * silent deletion of a boundary/house-rule enforcer fails `check`.
 */
const DOC_PROMISED_ENFORCERS: ReadonlyArray<{ id: string; target: ConfigTarget; doc: string }> = [
  { id: 'boundaries/element-types', target: 'eslint', doc: 'architecture.md §Layers' },
  { id: '@typescript-eslint/no-explicit-any', target: 'eslint', doc: 'CLAUDE.md §House rules' },
  { id: 'no-restricted-syntax', target: 'eslint', doc: 'CLAUDE.md §House rules (no `as`)' },
  { id: 'RAW_COLOR_BAN', target: 'eslint', doc: 'CLAUDE.md §House rules (theme-only visuals)' },
  { id: 'MUI_SKELETON_BAN', target: 'eslint', doc: 'ADR-0004 §(d) (page skeletons live in components/layout)' },
  {
    id: 'web-layouts-are-structure-only',
    target: 'depcruise',
    doc: 'architecture.md §The layout layer / ADR-0004 rule (a)',
  },
  { id: 'core-domain-depends-on-nothing', target: 'depcruise', doc: 'architecture.md §Layers' },
  { id: 'no-frameworks-in-core', target: 'depcruise', doc: 'architecture.md §Layers' },
  { id: 'web-features-are-islands', target: 'depcruise', doc: 'architecture.md §Frontend' },
  { id: 'electron-only-in-desktop', target: 'depcruise', doc: 'architecture.md §Layers' },
];

/**
 * Load-bearing ADR claims, checked in both directions: the doc still promises it
 * (`docRel` contains `docMarker`) AND the code still honours it (`code` returns
 * null, or an error string when it has drifted). A promise with no code anchor
 * yet (cursor grammar, ADR-0003 §d) enforces the doc side only, keeping the
 * contract recorded until the first list endpoint exists.
 */
interface AdrClaim {
  readonly id: string;
  readonly docRel: string;
  readonly docMarker: string;
  readonly code?: () => string | null;
}

const CATALOG_SCHEMA = 'adapters/db/global-catalog-schema.ts';
const SNAPSHOT_WRITER = 'core/server/usecases/catalog-snapshot.ts';
const FOLDER_IDENTITY = 'core/server/usecases/folder-identity.ts';
const SERVER_APP = 'apps/server/src/app.ts';
const ADR_CATALOG = 'docs/decisions/0002-global-catalog-layer.md';
const ADR_DATA = 'docs/decisions/0003-sqlite-data-conventions.md';

const ADR_CLAIMS: readonly AdrClaim[] = [
  {
    id: 'fts4-not-fts5',
    docRel: ADR_CATALOG,
    docMarker: 'FTS4',
    code: () => {
      if (!/USING\s+fts4/i.test(read(CATALOG_SCHEMA)))
        return `${CATALOG_SCHEMA} no longer declares the full-text index with USING fts4.`;
      if (/fts5/i.test(read(CATALOG_SCHEMA)))
        return `${CATALOG_SCHEMA} references fts5, but the bundled sql.js ships FTS4 only (ADR-0002 §a).`;
      return null;
    },
  },
  {
    id: 'global-index-canonical',
    docRel: ADR_CATALOG,
    docMarker: 'canonical',
    code: () =>
      existsSync(join(repoRoot, 'adapters/db/global-catalog.ts'))
        ? null
        : 'adapters/db/global-catalog.ts (the canonical global index store) is missing.',
  },
  {
    id: 'faces-excluded-from-snapshot',
    docRel: ADR_CATALOG,
    docMarker: 'excluded from the NDJSON snapshot',
    code: () => {
      const leaked = /face_observations|faceObservations|person_id|personId|\bpeople\b/.exec(
        read(SNAPSHOT_WRITER),
      );
      return leaked
        ? `${SNAPSHOT_WRITER} references face data ("${leaked[0]}"); faces must stay out of the snapshot (ADR-0002 §e).`
        : null;
    },
  },
  {
    id: 'single-writer-lock',
    docRel: 'docs/architecture.md',
    docMarker: 'catalog.lock',
    code: () =>
      has(SERVER_APP, 'withCatalogWriteLock')
        ? null
        : `${SERVER_APP} no longer funnels writes through withCatalogWriteLock (single-writer lock, ADR-0002 hotspot 4).`,
  },
  {
    id: 'iso-8601-timestamps',
    docRel: ADR_DATA,
    docMarker: 'ISO-8601',
    code: () => {
      if (!has(CATALOG_SCHEMA, "text('first_seen_at')"))
        return `${CATALOG_SCHEMA}: first_seen_at is no longer a text (ISO-8601) column (ADR-0003 §a).`;
      if (!has(FOLDER_IDENTITY, 'toISOString'))
        return `${FOLDER_IDENTITY} no longer mints timestamps with toISOString (ADR-0003 §a).`;
      return null;
    },
  },
  {
    id: 'app-minted-uuid-ids',
    docRel: ADR_DATA,
    docMarker: 'UUID',
    code: () => {
      if (!has(FOLDER_IDENTITY, 'randomUUID'))
        return `${FOLDER_IDENTITY} no longer mints ids with randomUUID (ADR-0003 §b).`;
      if (!has(CATALOG_SCHEMA, "text('folder_id').primaryKey()"))
        return `${CATALOG_SCHEMA}: folder_id is no longer an app-minted text primary key (ADR-0003 §b).`;
      return null;
    },
  },
  {
    id: 'cursor-pagination-grammar',
    docRel: ADR_DATA,
    docMarker: 'cursor',
  },
];

const problems: string[] = [];

const trackedMarkdown = execFileSync('git', ['ls-files', '-z', '*.md'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter((entry) => entry.length > 0);

for (const rel of trackedMarkdown) {
  const text = read(rel);
  for (const delimiter of LEAKED_DELIMITERS) {
    if (text.includes(delimiter))
      problems.push(`[delimiter] "${delimiter}" leaked into ${rel} — delete the stray tool/XML tag.`);
  }
}

const readmes = trackedMarkdown.filter((rel) => rel === 'README.md' || rel.endsWith('/README.md'));

const owningScripts = (rel: string): ReadonlySet<string> => {
  let dir = dirname(rel);
  for (;;) {
    const manifest = dir === '.' ? 'package.json' : `${dir}/package.json`;
    if (existsSync(join(repoRoot, manifest))) {
      const parsed: { scripts?: Record<string, string> } = JSON.parse(read(manifest));
      return new Set(Object.keys(parsed.scripts ?? {}));
    }
    if (dir === '.') return new Set();
    dir = dirname(dir);
  }
};

for (const rel of readmes) problems.push(...readmeScriptProblems(rel, read(rel), owningScripts(rel)));

for (const enforcer of DOC_PROMISED_ENFORCERS) {
  if (!configHasId(enforcer.id, enforcer.target))
    problems.push(
      `[docs->config] "${enforcer.id}" (${enforcer.doc}) is absent from ` +
        `${enforcer.target === 'eslint' ? eslintConfig : depcruiseConfig} — restore it or stop relying on it.`,
    );
}

for (const claim of ADR_CLAIMS) {
  if (!existsSync(join(repoRoot, claim.docRel))) {
    problems.push(`[adr] ${claim.id}: ${claim.docRel} is missing.`);
    continue;
  }
  if (!has(claim.docRel, claim.docMarker))
    problems.push(
      `[docs->code] ${claim.id}: ${claim.docRel} no longer states "${claim.docMarker}" — ` +
        `restore the promise or drop the claim from doc-lint.`,
    );
  const codeProblem = claim.code?.();
  if (codeProblem) problems.push(`[code->docs] ${claim.id}: ${codeProblem}`);
}

const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
for (const rel of trackedMarkdown) {
  const prose = read(rel)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '');
  for (const match of prose.matchAll(LINK)) {
    const target = match[1] ?? '';
    if (/^(https?:|mailto:|tel:|\/\/|#)/.test(target)) continue;
    const path = target.split('#')[0];
    if (!path) continue;
    if (!existsSync(resolve(dirname(join(repoRoot, rel)), path)))
      problems.push(`[link] ${rel}: relative link "${target}" points at a missing file.`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`doc-lint: ${problems.length} issue(s)\n\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `doc-lint: OK — ${DOC_PROMISED_ENFORCERS.length} promised enforcer(s) present, ` +
    `${ADR_CLAIMS.length} ADR claim(s) honoured in docs and code, ` +
    `${readmes.length} README(s) documenting only real package scripts, ` +
    `${trackedMarkdown.length} tracked .md file(s) clean of dead links and leaked delimiters.\n`,
);
