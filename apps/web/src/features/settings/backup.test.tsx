import { type ReactElement } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { BackupIndicatorState } from '@core/domain/index.js';

import { en } from '../../i18n/dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { createAppTheme } from '../../theme.js';
import { BackupIndicator } from './BackupIndicator.js';
import { SettingsBackupSection } from './SettingsBackupSection.js';

const theme = createAppTheme('light');
const renderThemed = (ui: ReactElement) =>
  renderWithProviders(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

interface StatusOverrides {
  enabled?: boolean;
  indicator?: BackupIndicatorState;
  lastSuccessAt?: string | null;
  lastErrorCode?: string | null;
  recoveryKeyStored?: boolean;
}

const status = (overrides: StatusOverrides = {}) => ({
  enabled: overrides.enabled ?? true,
  provider: 'service_account',
  connected: true,
  accountEmail: 'backup@example.com',
  serviceAccountFingerprint: 'sha256:0123456789ab',
  sharedDriveId: 'drive-1',
  folderName: 'AI Video Cataloger Backups',
  includeOptional: false,
  keepLast: 7,
  keepWeekly: 8,
  indicator: overrides.indicator ?? 'idle',
  phase: 'idle',
  percentage: null,
  activeJobId: null,
  lastSuccessAt: overrides.lastSuccessAt === undefined ? '2026-09-01T12:00:00.000Z' : overrides.lastSuccessAt,
  lastArchiveName: 'avc-critical-20260901T120000Z.avcbak',
  lastErrorCode: overrides.lastErrorCode ?? null,
  lastRestoreAt: null,
  nextDueAt: '2026-09-02T12:00:00.000Z',
  supportedSchemaVersions: { globalCatalog: 7, photos: 3 },
  connection: null,
  recoveryKeyStored: overrides.recoveryKeyStored ?? true,
});

const backupRow = (overrides: { remoteId: string; globalCatalog?: number; appVersion?: string }) => ({
  remoteId: overrides.remoteId,
  name: `${overrides.remoteId}.avcbak`,
  tier: 'critical',
  createdAt: '2026-09-01T12:00:00.000Z',
  sizeBytes: 2048,
  appVersion: overrides.appVersion ?? '0.7.0',
  schemaVersions: { globalCatalog: overrides.globalCatalog ?? 7, photos: 3 },
  keyFingerprint: 'sha256:0123456789ab',
});

const respondOk = (data: unknown) => HttpResponse.json({ ok: true, data });

const statusHandler = (overrides: StatusOverrides = {}) =>
  http.get('/api/backup/status', () => respondOk(status(overrides)));

const listHandler = (backups: readonly unknown[]) =>
  http.get('/api/backup/list', () => respondOk({ backups }));

describe('Settings > Backup', () => {
  it('offers only the enable switch while backup is off', async () => {
    server.use(statusHandler({ enabled: false, indicator: 'disabled' }), listHandler([]));
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() => expect(screen.getByTestId('backup-enabled-switch')).toBeTruthy());
    expect(screen.queryByTestId('backup-run-now')).toBeNull();
    expect(screen.queryByTestId('backup-list')).toBeNull();
  });

  it('cannot enable backup without completing the stepper', async () => {
    server.use(statusHandler({ enabled: false, indicator: 'disabled' }), listHandler([]));
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() => expect(screen.getByTestId('backup-enabled-switch')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-enabled-switch').querySelector('input') ?? document.body);

    await waitFor(() => expect(screen.getByTestId('backup-stepper')).toBeTruthy());
    expect(screen.getByTestId('backup-provider-service-account')).toBeTruthy();
  });

  it('shows last backup, next evaluation and the manual run action once enabled', async () => {
    server.use(statusHandler(), listHandler([backupRow({ remoteId: 'old' })]));
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() => expect(screen.getByTestId('backup-run-now')).toBeTruthy());
    const last = formatCapturedAt('2026-09-01T12:00:00.000Z', en.locale);
    const next = formatCapturedAt('2026-09-02T12:00:00.000Z', en.locale);
    expect(screen.getByTestId('backup-last-success').textContent).toBe(en.backup.lastBackup(last ?? ''));
    expect(screen.getByTestId('backup-next-due').textContent).toBe(en.backup.nextDue(next ?? ''));
    await waitFor(() => expect(screen.getByTestId('backup-row-old').textContent).toContain(en.backup.backupRow(last ?? '', '2.0 KB', '0.7.0')));
  });

  it('surfaces the last failure with its taxonomy message', async () => {
    server.use(statusHandler({ lastErrorCode: 'backup_quota_exceeded' }), listHandler([]));
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() =>
      expect(screen.getByTestId('backup-last-error').textContent).toBe(en.backup.errorMessages.backup_quota_exceeded));
  });

  it('offers restore for a supported archive and explains why a newer one is refused', async () => {
    server.use(
      statusHandler(),
      listHandler([backupRow({ remoteId: 'old' }), backupRow({ remoteId: 'newer', globalCatalog: 9, appVersion: '9.9.9' })]),
    );
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() => expect(screen.getByTestId('backup-restore-old')).toBeTruthy());
    expect(screen.queryByTestId('backup-restore-newer')).toBeNull();
    expect(screen.getByTestId('backup-unsupported-newer').textContent).toBe(en.backup.restoreUnsupported('9.9.9'));
  });

  it('requires a second deliberate click before a restore is submitted', async () => {
    const submitted: string[] = [];
    server.use(
      statusHandler(),
      listHandler([backupRow({ remoteId: 'old' })]),
      http.post('/api/backup/restore', async ({ request }) => {
        const body = await request.json();
        submitted.push(JSON.stringify(body));
        return respondOk({ jobId: 'restore-1' });
      }),
      http.get('/api/jobs/:jobId', () => respondOk({
        jobId: 'restore-1',
        kind: 'restore',
        status: 'running',
        progress: { step: 'downloading' },
        progressEvents: [],
        error: null,
        createdAt: '2026-09-02T12:00:00.000Z',
        updatedAt: '2026-09-02T12:00:00.000Z',
      })),
    );
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() => expect(screen.getByTestId('backup-restore-old')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-restore-old'));

    const dialog = await screen.findByTestId('backup-restore-dialog');
    expect(dialog.textContent).toContain(en.backup.restoreDialogPreRestore);
    expect(dialog.textContent).toContain(en.backup.restoreDialogRelaunch);

    fireEvent.click(screen.getByTestId('backup-restore-confirm'));
    expect(submitted).toEqual([]);

    fireEvent.click(screen.getByTestId('backup-restore-confirm-final'));
    await waitFor(() => expect(submitted).toEqual([JSON.stringify({ remoteId: 'old' })]));
  });

  it('sends the pasted recovery key with a restore started on a Mac without the key', async () => {
    const submitted: string[] = [];
    server.use(
      statusHandler({ recoveryKeyStored: false }),
      listHandler([backupRow({ remoteId: 'old' })]),
      http.post('/api/backup/restore', async ({ request }) => {
        submitted.push(JSON.stringify(await request.json()));
        return respondOk({ jobId: 'restore-1' });
      }),
    );
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() => expect(screen.getByTestId('backup-restore-old')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-restore-old'));
    await screen.findByTestId('backup-restore-dialog');

    expect(screen.getByTestId('backup-restore-confirm').hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByTestId('backup-restore-recovery-key'), { target: { value: 'RECOVERY-KEY-FROM-OTHER-MAC' } });
    fireEvent.click(screen.getByTestId('backup-restore-confirm'));
    fireEvent.click(screen.getByTestId('backup-restore-confirm-final'));

    await waitFor(() => expect(submitted).toEqual([
      JSON.stringify({ remoteId: 'old', recoveryKey: 'RECOVERY-KEY-FROM-OTHER-MAC' }),
    ]));
  });

  it('does not say nothing changed when restore failed after rollback protection started', async () => {
    server.use(
      statusHandler(),
      listHandler([backupRow({ remoteId: 'old' })]),
      http.post('/api/backup/restore', () =>
        HttpResponse.json({ ok: false, error: { code: 'restore_incomplete', message: 'Restore did not finish' } }, { status: 500 })),
    );
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() => expect(screen.getByTestId('backup-restore-old')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-restore-old'));
    await screen.findByTestId('backup-restore-dialog');
    fireEvent.click(screen.getByTestId('backup-restore-confirm'));
    fireEvent.click(screen.getByTestId('backup-restore-confirm-final'));

    await waitFor(() => expect(screen.getByTestId('backup-restore-error').textContent).toBe(en.backup.errorMessages.restore_incomplete));
  });
});

describe('bottom-bar backup indicator', () => {
  it('stays hidden while backup is disabled', async () => {
    server.use(statusHandler({ enabled: false, indicator: 'disabled' }));
    renderThemed(<BackupIndicator onOpenSettings={() => undefined} />);

    await waitFor(() => expect(screen.queryByTestId('backup-indicator')).toBeNull());
  });

  it('shows the idle glyph with the last backup date in its tooltip', async () => {
    server.use(statusHandler());
    renderThemed(<BackupIndicator onOpenSettings={() => undefined} />);

    const indicator = await screen.findByTestId('backup-indicator');
    expect(indicator.getAttribute('data-state')).toBe('idle');
    expect(screen.getByRole('status')).toBe(indicator);
    fireEvent.mouseOver(indicator);
    const last = formatCapturedAt('2026-09-01T12:00:00.000Z', en.locale) ?? '';
    await waitFor(() =>
      expect(screen.getByRole('tooltip').textContent).toBe(en.backup.indicatorIdle(last)));
  });

  it('announces a running backup as a polite status region', async () => {
    server.use(statusHandler({ indicator: 'running' }));
    renderThemed(<BackupIndicator onOpenSettings={() => undefined} />);

    const indicator = await screen.findByRole('status');

    expect(indicator.getAttribute('data-state')).toBe('running');
    expect(indicator.getAttribute('aria-live')).toBe('polite');
  });

  it('opens Settings from the failed state', async () => {
    let opened = 0;
    server.use(statusHandler({ indicator: 'failed', lastErrorCode: 'backup_destination_error' }));
    renderThemed(<BackupIndicator onOpenSettings={() => { opened += 1; }} />);

    const indicator = await screen.findByTestId('backup-indicator');
    expect(indicator.getAttribute('data-state')).toBe('failed');
    fireEvent.click(indicator);
    expect(opened).toBe(1);
  });
});

describe('Settings > Backup interactions', () => {
  it('runs a manual backup and persists the tier and retention settings', async () => {
    const runs: string[] = [];
    const configWrites: string[] = [];
    server.use(
      statusHandler(),
      listHandler([]),
      http.post('/api/backup/run', async ({ request }) => {
        runs.push(JSON.stringify(await request.json()));
        return respondOk({ jobId: 'backup-1' });
      }),
      http.post('/api/config', async ({ request }) => {
        const body = await request.json();
        configWrites.push(JSON.stringify(body));
        return respondOk({ key: 'backup_keep_last', value: '14', previousValue: '7', scope: 'home', ignoredFolderValue: null });
      }),
    );
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() => expect(screen.getByTestId('backup-run-now')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-run-now'));
    await waitFor(() => expect(runs).toEqual([JSON.stringify({ tier: 'critical' })]));

    fireEvent.click(screen.getByTestId('backup-optional-tier-switch').querySelector('input') ?? document.body);
    await waitFor(() =>
      expect(configWrites).toContain(JSON.stringify({ key: 'backup_include_optional', value: 'true' })));

    const keepLast = screen.getByTestId('backup-keep-last');
    fireEvent.change(keepLast, { target: { value: '400' } });
    fireEvent.blur(keepLast);
    await waitFor(() => expect(configWrites).toContain(JSON.stringify({ key: 'backup_keep_last', value: '90' })));

    const keepWeekly = screen.getByTestId('backup-keep-weekly');
    fireEvent.change(keepWeekly, { target: { value: '4' } });
    fireEvent.blur(keepWeekly);
    await waitFor(() => expect(configWrites).toContain(JSON.stringify({ key: 'backup_keep_weekly', value: '4' })));
  });

  it('turns backup off through the switch without purging credentials', async () => {
    const disables: string[] = [];
    server.use(
      statusHandler(),
      listHandler([]),
      http.post('/api/backup/disable', async ({ request }) => {
        disables.push(JSON.stringify(await request.json()));
        return respondOk({ enabled: false });
      }),
    );
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() => expect(screen.getByTestId('backup-run-now')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-enabled-switch').querySelector('input') ?? document.body);

    await waitFor(() => expect(disables).toEqual([JSON.stringify({ purgeCredentials: false })]));
  });

  it('shows the failure of a manual run with its taxonomy message', async () => {
    server.use(
      statusHandler(),
      listHandler([]),
      http.post('/api/backup/run', () =>
        HttpResponse.json({ ok: false, error: { code: 'backup_quota_exceeded', message: 'no room' } }, { status: 507 })),
    );
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() => expect(screen.getByTestId('backup-run-now')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-run-now'));

    await waitFor(() =>
      expect(screen.getByTestId('backup-error').textContent).toBe(en.backup.errorMessages.backup_quota_exceeded));
  });

  it('filters the backup list by tier', async () => {
    const tiers: Array<string | null> = [];
    server.use(
      statusHandler(),
      http.get('/api/backup/list', ({ request }) => {
        tiers.push(new URL(request.url).searchParams.get('tier'));
        return respondOk({ backups: [] });
      }),
    );
    renderThemed(<SettingsBackupSection open />);

    await waitFor(() => expect(tiers).toEqual([null]));
    fireEvent.mouseDown(screen.getByTestId('backup-tier-filter').querySelector('[role="combobox"]') ?? document.body);
    fireEvent.click(screen.getByRole('option', { name: en.backup.tierOptional }));

    await waitFor(() => expect(tiers).toContain('optional'));
  });
});

describe('backup enablement stepper', () => {
  const openStepper = async () => {
    renderThemed(<SettingsBackupSection open />);
    await waitFor(() => expect(screen.getByTestId('backup-enabled-switch')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-enabled-switch').querySelector('input') ?? document.body);
    await waitFor(() => expect(screen.getByTestId('backup-stepper')).toBeTruthy());
  };

  it('connects a service account, gates Finish on the recovery key, and enables backup', async () => {
    const calls: string[] = [];
    server.use(
      statusHandler({ enabled: false, indicator: 'disabled' }),
      listHandler([]),
      http.post('/api/backup/connect', async ({ request }) => {
        calls.push(`connect:${JSON.stringify(await request.json())}`);
        return respondOk({
          provider: 'service_account',
          connection: {
            accountEmail: 'backup@example.com',
            driveName: 'Company Backups',
            folderName: 'AI Video Cataloger Backups',
            remainingQuotaBytes: null,
          },
          serviceAccountFingerprint: 'sha256:0123456789ab',
        });
      }),
      http.post('/api/backup/recovery-key/export', () => {
        calls.push('export');
        return respondOk({ fingerprint: 'sha256:0123456789ab', path: '/tmp/recovery-key.txt' });
      }),
      http.post('/api/backup/recovery-key/confirm', () => {
        calls.push('confirm');
        return respondOk({ confirmed: true });
      }),
      http.post('/api/backup/enable', async ({ request }) => {
        calls.push(`enable:${JSON.stringify(await request.json())}`);
        return respondOk({ enabled: true, jobId: 'backup-1' });
      }),
    );
    await openStepper();

    fireEvent.click(screen.getByTestId('backup-provider-service-account'));
    fireEvent.click(screen.getByTestId('backup-stepper-next'));

    fireEvent.change(screen.getByTestId('backup-shared-drive-id'), { target: { value: 'drive-1' } });
    fireEvent.change(screen.getByTestId('backup-key-json'), { target: { value: '{"type":"service_account"}' } });
    fireEvent.click(screen.getByTestId('backup-connect'));

    await waitFor(() => expect(screen.getByTestId('backup-export-recovery-key')).toBeTruthy());
    expect(calls[0]).toBe(`connect:${JSON.stringify({
      provider: 'service_account',
      keyJson: '{"type":"service_account"}',
      sharedDriveId: 'drive-1',
    })}`);

    expect(screen.getByTestId('backup-finish').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('backup-export-recovery-key'));
    await waitFor(() => expect(screen.getByTestId('backup-recovery-key-report').textContent)
      .toContain('/tmp/recovery-key.txt'));
    expect(screen.getByTestId('backup-finish').hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByTestId('backup-recovery-key-saved').querySelector('input') ?? document.body);
    fireEvent.click(screen.getByTestId('backup-finish'));

    await waitFor(() => expect(calls).toContain(`enable:${JSON.stringify({
      includeOptional: false,
      keepLast: 7,
      keepWeekly: 8,
      runFirstBackup: true,
      acknowledgeUnreadableArchives: false,
    })}`));
    expect(calls).toContain('confirm');
    await waitFor(() => expect(screen.queryByTestId('backup-stepper')).toBeNull());
  });

  it('demands the other Mac\'s recovery key before minting a new one over existing archives', async () => {
    const calls: string[] = [];
    server.use(
      statusHandler({ enabled: false, indicator: 'disabled', recoveryKeyStored: false }),
      listHandler([backupRow({ remoteId: 'from-old-mac' })]),
      http.post('/api/backup/connect', () => respondOk({
        provider: 'service_account',
        connection: {
          accountEmail: 'backup@example.com',
          driveName: null,
          folderName: 'AI Video Cataloger Backups',
          remainingQuotaBytes: null,
        },
        serviceAccountFingerprint: 'sha256:0123456789ab',
      })),
      http.post('/api/backup/recovery-key/export', () =>
        respondOk({ fingerprint: 'sha256:0123456789ab', path: '/tmp/recovery-key.txt' })),
      http.post('/api/backup/recovery-key/import', async ({ request }) => {
        calls.push(`import:${JSON.stringify(await request.json())}`);
        return respondOk({ fingerprint: 'sha256:abcdefabcdef' });
      }),
    );
    await openStepper();

    fireEvent.click(screen.getByTestId('backup-stepper-next'));
    fireEvent.click(screen.getByTestId('backup-connect'));

    await waitFor(() => expect(screen.getByTestId('backup-existing-archives')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-export-recovery-key'));
    await waitFor(() => expect(screen.getByTestId('backup-recovery-key-report')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-recovery-key-saved').querySelector('input') ?? document.body);
    expect(screen.getByTestId('backup-finish').hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByTestId('backup-import-recovery-key'), { target: { value: 'OTHER-MAC-KEY' } });
    fireEvent.click(screen.getByTestId('backup-import-recovery-key-submit'));

    await waitFor(() => expect(calls).toEqual([`import:${JSON.stringify({ recoveryKey: 'OTHER-MAC-KEY' })}`]));
    await waitFor(() => expect(screen.getByTestId('backup-imported-recovery-key').textContent)
      .toBe(en.backup.recoveryKeyImported('sha256:abcdefabcdef')));
    expect(screen.getByTestId('backup-finish').hasAttribute('disabled')).toBe(false);
  });

  it('lets an explicit acknowledgement replace the other Mac\'s key', async () => {
    server.use(
      statusHandler({ enabled: false, indicator: 'disabled', recoveryKeyStored: false }),
      listHandler([backupRow({ remoteId: 'from-old-mac' })]),
      http.post('/api/backup/connect', () => respondOk({
        provider: 'service_account',
        connection: {
          accountEmail: 'backup@example.com',
          driveName: null,
          folderName: 'AI Video Cataloger Backups',
          remainingQuotaBytes: null,
        },
        serviceAccountFingerprint: 'sha256:0123456789ab',
      })),
      http.post('/api/backup/recovery-key/export', () =>
        respondOk({ fingerprint: 'sha256:0123456789ab', path: '/tmp/recovery-key.txt' })),
    );
    await openStepper();

    fireEvent.click(screen.getByTestId('backup-stepper-next'));
    fireEvent.click(screen.getByTestId('backup-connect'));

    await waitFor(() => expect(screen.getByTestId('backup-existing-archives')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-export-recovery-key'));
    await waitFor(() => expect(screen.getByTestId('backup-recovery-key-report')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-recovery-key-saved').querySelector('input') ?? document.body);
    expect(screen.getByTestId('backup-finish').hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByTestId('backup-acknowledge-unreadable').querySelector('input') ?? document.body);

    expect(screen.getByTestId('backup-finish').hasAttribute('disabled')).toBe(false);
  });

  it('shows a waiting state during the browser round trip and cancels it on demand', async () => {
    let cancelled = 0;
    server.use(
      statusHandler({ enabled: false, indicator: 'disabled' }),
      listHandler([]),
      http.post('/api/backup/connect', () => new Promise(() => undefined)),
      http.post('/api/backup/connect/cancel', () => {
        cancelled += 1;
        return respondOk({ cancelled: true });
      }),
    );
    await openStepper();

    fireEvent.click(screen.getByTestId('backup-stepper-next'));
    fireEvent.click(screen.getByTestId('backup-connect'));

    await waitFor(() => expect(screen.getByTestId('backup-connect-waiting').textContent).toBe(en.backup.connectWaiting));
    fireEvent.click(screen.getByTestId('backup-connect-cancel'));

    await waitFor(() => expect(cancelled).toBe(1));
  });

  it('cancels a pending connect when the stepper is closed', async () => {
    let cancelled = 0;
    server.use(
      statusHandler({ enabled: false, indicator: 'disabled' }),
      listHandler([]),
      http.post('/api/backup/connect', () => new Promise(() => undefined)),
      http.post('/api/backup/connect/cancel', () => {
        cancelled += 1;
        return respondOk({ cancelled: true });
      }),
    );
    await openStepper();

    fireEvent.click(screen.getByTestId('backup-stepper-next'));
    fireEvent.click(screen.getByTestId('backup-connect'));
    await waitFor(() => expect(screen.getByTestId('backup-connect-waiting')).toBeTruthy());
    fireEvent.click(screen.getByTestId('backup-stepper-cancel'));

    await waitFor(() => expect(cancelled).toBe(1));
  });

  it('reports a refused connection and keeps the stepper on the connect step', async () => {
    server.use(
      statusHandler({ enabled: false, indicator: 'disabled' }),
      listHandler([]),
      http.post('/api/backup/connect', () =>
        HttpResponse.json({ ok: false, error: { code: 'backup_auth_required', message: 'reconnect' } }, { status: 401 })),
    );
    await openStepper();

    fireEvent.click(screen.getByTestId('backup-stepper-next'));
    fireEvent.click(screen.getByTestId('backup-connect'));

    await waitFor(() =>
      expect(screen.getByTestId('backup-stepper-error').textContent).toBe(en.backup.errorMessages.backup_auth_required));
    expect(screen.queryByTestId('backup-finish')).toBeNull();
  });

  it('reports a successful connection test on demand', async () => {
    server.use(
      statusHandler({ enabled: false, indicator: 'disabled' }),
      listHandler([]),
      http.post('/api/backup/test', () => respondOk({
        connection: {
          accountEmail: 'person@example.com',
          driveName: null,
          folderName: 'AI Video Cataloger Backups',
          remainingQuotaBytes: 4096,
        },
      })),
    );
    await openStepper();

    fireEvent.click(screen.getByTestId('backup-stepper-next'));
    fireEvent.click(screen.getByTestId('backup-test-connection'));

    await waitFor(() => expect(screen.getByTestId('backup-connection-report').textContent)
      .toBe(en.backup.connectionReport('person@example.com', 'AI Video Cataloger Backups')));
  });

  it('abandons the stepper without enabling backup', async () => {
    server.use(statusHandler({ enabled: false, indicator: 'disabled' }), listHandler([]));
    await openStepper();

    fireEvent.click(screen.getByTestId('backup-stepper-cancel'));

    await waitFor(() => expect(screen.queryByTestId('backup-stepper')).toBeNull());
    expect(screen.queryByTestId('backup-run-now')).toBeNull();
  });
});
