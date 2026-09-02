import { describe, expect, it } from 'vitest';

import { API_ROUTES, looseEnvelopeSchema } from '@core/contract/index.js';
import { appError, ok } from '@core/domain/index.js';

import { createApp } from './create-app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

describe('POST /api/backup/restore', () => {
  it('acquires the catalog write lease, releases it once the job settles, and returns the accepted job', async () => {
    const leaseCalls: string[] = [];
    const app = createApp({ dbDriver: 'memory', processName: 'gui' }, (config) => {
      const deps = createInMemoryDeps(config);
      deps.globalCatalog.acquireLease = () => {
        leaseCalls.push('acquire');
        return Promise.resolve(ok(undefined));
      };
      deps.globalCatalog.releaseLease = () => {
        leaseCalls.push('release');
        return Promise.resolve(ok(undefined));
      };
      deps.restoreBackup = () =>
        deps.jobs.enqueue({
          kind: 'process',
          payload: { remoteId: 'remote-1' },
          run: () => Promise.resolve(ok(undefined)),
        });
      return deps;
    });

    try {
      const response = await app.honoApp.request(API_ROUTES.backupRestore.path, {
        method: API_ROUTES.backupRestore.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ remoteId: 'remote-1' }),
      });
      const envelope = looseEnvelopeSchema.parse(await response.json());
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) throw new Error('expected an accepted envelope');
      expect(envelope.data).toMatchObject({ jobId: expect.any(String) });

      for (let attempt = 0; attempt < 100 && !leaseCalls.includes('release'); attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
      }
      expect(leaseCalls).toEqual(['acquire', 'release']);
    } finally {
      await app.dispose();
    }
  });

  it('releases the lease and surfaces the error when the restore use case rejects synchronously', async () => {
    const leaseCalls: string[] = [];
    const app = createApp({ dbDriver: 'memory', processName: 'gui' }, (config) => {
      const deps = createInMemoryDeps(config);
      deps.globalCatalog.acquireLease = () => {
        leaseCalls.push('acquire');
        return Promise.resolve(ok(undefined));
      };
      deps.globalCatalog.releaseLease = () => {
        leaseCalls.push('release');
        return Promise.resolve(ok(undefined));
      };
      deps.restoreBackup = () =>
        Promise.resolve({ ok: false, error: appError('restore_refused', 'A catalog job is running') });
      return deps;
    });

    try {
      const response = await app.honoApp.request(API_ROUTES.backupRestore.path, {
        method: API_ROUTES.backupRestore.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ remoteId: 'remote-1' }),
      });
      const envelope = looseEnvelopeSchema.parse(await response.json());
      expect(envelope.ok).toBe(false);
      expect(leaseCalls).toEqual(['acquire', 'release']);
    } finally {
      await app.dispose();
    }
  });
});
