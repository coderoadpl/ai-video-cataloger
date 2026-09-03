import { describe, expect, it } from 'vitest';

import { API_ROUTES, looseEnvelopeSchema } from '@core/contract/index.js';
import { appError, ok } from '@core/domain/index.js';

import { createApp } from './create-app.js';
import { createInMemoryDeps } from './test-support/in-memory-deps.js';

const connectBody = JSON.stringify({ provider: 'google_oauth', keyJson: null, sharedDriveId: null });

describe('POST /api/backup/connect', () => {
  it('aborts the pending browser round trip when the cancel route is called', async () => {
    const app = createApp({ dbDriver: 'memory', processName: 'gui' }, (config) => ({
      ...createInMemoryDeps(config),
      connectBackup: (_request, signal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          resolve({ ok: false, error: appError('backup_auth_required', 'Google authorization was cancelled') });
        }, { once: true });
      }),
    }));

    try {
      const connecting = app.honoApp.request(API_ROUTES.backupConnect.path, {
        method: API_ROUTES.backupConnect.method,
        headers: { 'content-type': 'application/json' },
        body: connectBody,
      });
      await settle();
      const cancelled = await app.honoApp.request(API_ROUTES.backupConnectCancel.path, {
        method: API_ROUTES.backupConnectCancel.method,
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      expect(looseEnvelopeSchema.parse(await cancelled.json())).toMatchObject({ ok: true, data: { cancelled: true } });
      const envelope = looseEnvelopeSchema.parse(await (await connecting).json());
      expect(envelope).toMatchObject({ ok: false, error: { code: 'backup_auth_required' } });
    } finally {
      await app.dispose();
    }
  });

  it('refuses a second concurrent connect instead of opening a second browser tab', async () => {
    let opened = 0;
    const app = createApp({ dbDriver: 'memory', processName: 'gui' }, (config) => ({
      ...createInMemoryDeps(config),
      connectBackup: (_request, signal) => {
        opened += 1;
        return new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            resolve({ ok: false, error: appError('backup_auth_required', 'Google authorization was cancelled') });
          }, { once: true });
        });
      },
    }));

    try {
      const connecting = app.honoApp.request(API_ROUTES.backupConnect.path, {
        method: API_ROUTES.backupConnect.method,
        headers: { 'content-type': 'application/json' },
        body: connectBody,
      });
      await settle();
      const second = await app.honoApp.request(API_ROUTES.backupConnect.path, {
        method: API_ROUTES.backupConnect.method,
        headers: { 'content-type': 'application/json' },
        body: connectBody,
      });

      expect(looseEnvelopeSchema.parse(await second.json())).toMatchObject({ ok: false, error: { code: 'conflict' } });
      expect(opened).toBe(1);
      await app.honoApp.request(API_ROUTES.backupConnectCancel.path, {
        method: API_ROUTES.backupConnectCancel.method,
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      await connecting;
    } finally {
      await app.dispose();
    }
  });

  it('reports nothing to cancel when no connect is in flight', async () => {
    const app = createApp({ dbDriver: 'memory', processName: 'gui' }, (config) => ({
      ...createInMemoryDeps(config),
      connectBackup: () => Promise.resolve(ok({
        provider: 'google_oauth' as const,
        connection: { accountEmail: null, driveName: null, folderName: 'folder', remainingQuotaBytes: null },
        serviceAccountFingerprint: null,
      })),
    }));

    try {
      const response = await app.honoApp.request(API_ROUTES.backupConnectCancel.path, {
        method: API_ROUTES.backupConnectCancel.method,
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      expect(looseEnvelopeSchema.parse(await response.json())).toMatchObject({ ok: true, data: { cancelled: false } });
    } finally {
      await app.dispose();
    }
  });
});

const settle = async (): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) await new Promise<void>((resolve) => setTimeout(resolve, 2));
};
