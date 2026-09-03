import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');
const appSource = readFileSync(join(repoRoot, 'apps', 'server', 'src', 'app.ts'), 'utf8');

const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const ROUTE = /app\.(get|post|put|patch|delete)\(\s*API_ROUTES\.(\w+)\.path\s*,/g;

interface Route {
  method: string;
  name: string;
  wrapped: boolean;
}

const scanRoutes = (source: string): Route[] => {
  const matches = [...source.matchAll(ROUTE)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? source.length;
    const body = source.slice(start, end);
    return {
      method: match[1] ?? '',
      name: match[2] ?? '',
      wrapped: body.includes('withCatalogWriteLock'),
    };
  });
};

const routes = scanRoutes(appSource);
const mutating = routes.filter((route) => MUTATING_METHODS.has(route.method));

const NO_LOCK_REASON: Record<string, string> = {
  catalogLockRetry: 'acquires the write lock itself; it is the lock primitive, not a guarded write',
  thumbnail: 'writes the derived thumbnail cache, never the canonical global catalog',
  thumbnails: 'writes only derived thumbnail-cache files, never the canonical global catalog',
  configSet: 'writes the user-settings store, not the global catalog',
  configUnset: 'clears a folder override in the user-settings store, not the global catalog',
  credentialSet: 'writes the OS keychain, not the global catalog',
  credentialDelete: 'clears the OS keychain and the credentials file, not the global catalog',
  providerTest: 'read-only provider probe, performs no write',
  whisperModelDownload: 'manages the whisper model store, not the global catalog',
  whisperModelDelete: 'manages the whisper model store, not the global catalog',
  whisperModelUse: 'selects the active whisper model, not a global-catalog write',
  whisperRuntimeInstall: 'installs the whisper runtime, not a global-catalog write',
  localAiPull: 'manages local AI models, not the global catalog',
  localAiRm: 'manages local AI models, not the global catalog',
  localAiDaemonStop: 'controls the local AI daemon, performs no catalog write',
  jobCancel: 'cancels an in-flight job; it does not write the catalog',
  faceArtifactsInstall: 'installs face model artifacts, not a global-catalog write',
  backupRun: 'enqueues the backup job, which claims the catalog-write resource itself for its snapshot phase',
  backupConnect: 'stores destination settings and keychain items, not the global catalog',
  backupTest: 'read-only destination probe, performs no write',
  backupEnable: 'writes backup settings in the user-settings store, not the global catalog',
  backupDisable: 'writes backup settings and clears keychain items, not the global catalog',
  backupRecoveryKeyExport: 'writes the recovery-key file through the native save dialog, not the global catalog',
  backupRecoveryKeyConfirm: 'records the in-session recovery-key confirmation, performs no write',
  backupRecoveryKeyImport: 'stores the pasted recovery key in the OS keychain, not the global catalog',
  backupConnectCancel: 'aborts the pending destination connection, performs no write',
  librarySelectionPreview: 'read-only selection preview, performs no write',
  libraryTrash: 'acquires the catalog lease itself and holds it across the trash job, not a synchronous lock-wrapped write',
};

describe('catalog write-lock funnel (hotspot 4)', () => {
  it('finds the known lock-wrapped mutating routes (guards against a vacuous scan)', () => {
    const wrapped = new Set(routes.filter((route) => route.wrapped).map((route) => route.name));
    for (const known of [
      'process',
      'processDrive',
      'resetAll',
      'resetSingle',
      'indexRebuild',
      'indexForget',
      'tagsAlias',
      'facesIndex',
      'facesName',
      'facesMerge',
      'facesForget',
      'facesPurge',
      'facesRecluster',
      'facesExemplars',
    ]) {
      expect(wrapped.has(known)).toBe(true);
    }
  });

  it('every mutating route is lock-wrapped unless it is a named no-write exception', () => {
    const offenders = mutating
      .filter((route) => !route.wrapped && !(route.name in NO_LOCK_REASON))
      .map((route) => `${route.method.toUpperCase()} ${route.name}`);
    expect(offenders).toEqual([]);
  });

  it('the no-write allowlist has no stale entries', () => {
    const mutatingNames = new Set(mutating.map((route) => route.name));
    const stale = Object.keys(NO_LOCK_REASON).filter((name) => !mutatingNames.has(name));
    expect(stale).toEqual([]);
  });

  it('detects an unwrapped mutating write route (the regression this probe guards)', () => {
    const planted =
      "app.post(API_ROUTES.evilPurge.path, async () =>\n" +
      '    respond(await facesPurge(deps), API_ROUTES.evilPurge.output),\n' +
      '  );\n';
    const plantedRoutes = scanRoutes(planted).filter((route) => MUTATING_METHODS.has(route.method));
    const offenders = plantedRoutes
      .filter((route) => !route.wrapped && !(route.name in NO_LOCK_REASON))
      .map((route) => route.name);
    expect(offenders).toContain('evilPurge');
  });
});
