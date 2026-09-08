import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { runPrerelease } from './e2e-prerelease.js';
import { checkInstalledVersions } from './installed-runtime.js';

const roots: string[] = [];
const root = () => {
  const dir = mkdtempSync(join(tmpdir(), 'avc-gate-probe-'));
  roots.push(dir);
  return dir;
};
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it.each([
  { suites: [] },
  { suites: [{ specs: [{ title: 'wrong project', tests: [{ projectName: 'people', status: 'expected' }] }] }] },
])('rejects exit zero without executed tests for the expected project', (report) => {
  let calls = 0;
  expect(() => runPrerelease(root(), (_leg, file) => {
    calls += 1;
    writeFileSync(file, JSON.stringify(report));
    return 0;
  })).toThrow(/executed tests/);
  expect(calls).toBe(1);
});

it('rejects concurrent runners before either can overwrite shared build outputs', () => {
  const dir = root();
  expect(() => runPrerelease(dir, () => {
    expect(() => runPrerelease(dir, () => 0)).toThrow(/already running/);
    throw new Error('stop probe');
  })).toThrow('stop probe');
  expect(() => runPrerelease(dir, () => { throw new Error('lock released'); })).toThrow('lock released');
});

it('rejects stale installed Electron and names the reinstall command', () => {
  const dir = root();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { electron: '41.10.7' } }));
  mkdirSync(join(dir, 'node_modules/electron'), { recursive: true });
  writeFileSync(join(dir, 'node_modules/electron/package.json'), JSON.stringify({ version: '37.10.3' }));
  const result = checkInstalledVersions(dir, [{ devDependencies: { electron: { version: '41.10.7' } } }]);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.message).toMatch(/electron.*37\.10\.3.*41\.10\.7.*pnpm install/s);
});

it('rejects a parity report missing GUI executions even after successful earlier legs', () => {
  expect(() => runPrerelease(root(), (leg, file) => {
    writeFileSync(file, JSON.stringify({ suites: [{ specs: [{ title: 'executed', tests: [{ projectName: leg === 'parity' ? 'cli' : leg, status: 'expected', results: [{ status: 'passed' }] }] }] }] }));
    return 0;
  })).toThrow(/expected project "gui"/);
});

it('fails exit-zero reports with flaky tests and keeps flaky counts separate', () => {
  expect(runPrerelease(root(), (leg, file) => {
    writeFileSync(file, JSON.stringify({ suites: [{ specs: [{ title: 'recovered', tests: [{ projectName: leg, status: 'flaky', results: [{ status: 'failed' }, { status: 'passed' }] }] }] }] }));
    return 0;
  })).toBe(1);
});

it('uses unique report directories outside Playwright output across invocations', () => {
  const dir = root();
  const files: string[] = [];
  for (let run = 0; run < 2; run += 1) {
    expect(runPrerelease(dir, (_leg, file) => { files.push(file); return 1; })).toBe(1);
  }
  expect(files[0]).not.toBe(files[1]);
  expect(files.every((file) => !file.includes('test-results'))).toBe(true);
});

it('checks every declared version and the Electron binary version file', () => {
  const dir = root();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '19.1.0' }, devDependencies: { electron: '41.10.7' } }));
  mkdirSync(join(dir, 'node_modules/react'), { recursive: true });
  mkdirSync(join(dir, 'node_modules/electron/dist'), { recursive: true });
  writeFileSync(join(dir, 'node_modules/electron/package.json'), JSON.stringify({ version: '41.10.7' }));
  writeFileSync(join(dir, 'node_modules/electron/dist/version'), '41.10.7');
  writeFileSync(join(dir, 'node_modules/react/package.json'), JSON.stringify({ version: '19.0.0' }));
  const locked = [{ dependencies: { react: { version: '19.1.0' } }, devDependencies: { electron: { version: '41.10.7' } } }];
  const stale = checkInstalledVersions(dir, locked);
  expect(stale.ok).toBe(false);
  if (!stale.ok) expect(stale.error.message).toMatch(/react: installed 19\.0\.0, locked 19\.1\.0/);
  writeFileSync(join(dir, 'node_modules/react/package.json'), JSON.stringify({ version: '19.1.0' }));
  expect(checkInstalledVersions(dir, locked)).toEqual({ ok: true, value: '41.10.7' });
  writeFileSync(join(dir, 'node_modules/electron/dist/version'), '37.10.3');
  const binary = checkInstalledVersions(dir, locked);
  expect(binary.ok).toBe(false);
  if (!binary.ok) expect(binary.error.message).toMatch(/electron binary: installed 37\.10\.3/);
  expect(checkInstalledVersions(dir, {} ).ok).toBe(false);
});

it('rejects claimed expected tests that contain no execution results', () => {
  expect(() => runPrerelease(root(), (leg, file) => {
    const projects = leg === 'parity' ? ['cli', 'gui'] : [leg === 'backup' ? 'backup-settings' : leg];
    writeFileSync(file, JSON.stringify({ suites: [{ specs: [{ title: 'not executed', tests: projects.map((projectName) => ({ projectName, status: 'expected', results: [] })) }] }] }));
    return 0;
  })).toThrow(/executed tests/);
});

it('accepts all mandatory legs only when every expected project records an execution', () => {
  const legs: string[] = [];
  expect(runPrerelease(root(), (leg, file) => {
    legs.push(leg);
    const projects = leg === 'parity' ? ['cli', 'gui'] : [leg === 'backup' ? 'backup-settings' : leg];
    writeFileSync(file, JSON.stringify({ suites: [{ specs: [{ title: 'executed', tests: projects.map((projectName) => ({ projectName, status: 'expected', results: [{ status: 'passed' }] })) }] }] }));
    return 0;
  })).toBe(0);
  expect(legs).toHaveLength(13);
});
