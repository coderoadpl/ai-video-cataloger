import { describe, expect, it } from 'vitest';

import type { BackupTier, RemoteBackup } from '@core/domain/index.js';

import { selectForDeletion } from './backup-retention.js';

const now = new Date('2026-09-02T12:00:00.000Z');
const KEY = 'sha256:0123456789ab';

describe('backup retention', () => {
  it.each([
    ['empty', [], { keepLast: 7, keepWeekly: 8 }, []],
    ['fewer than keepLast', [0, 1, 2], { keepLast: 7, keepWeekly: 8 }, []],
    ['several in current week', [0, 1, 2, 3], { keepLast: 1, keepWeekly: 1 }, [1, 2, 3]],
    ['lone 18-month-old backup', [550], { keepLast: 0, keepWeekly: 0 }, []],
    ['keepLast one, no weekly', [0, 1, 2], { keepLast: 1, keepWeekly: 0 }, [1, 2]],
    ['today only', [0], { keepLast: 1, keepWeekly: 8 }, []],
    ['weekly union keeps an older member', [0, 1, 8, 9, 15], { keepLast: 1, keepWeekly: 3 }, [1, 9]],
    ['outside weekly window', [0, 8, 60], { keepLast: 1, keepWeekly: 2 }, [60]],
    ['keepLast spans weeks', [0, 8, 15], { keepLast: 2, keepWeekly: 0 }, [15]],
    ['zero policies preserve newest', [0, 1, 2], { keepLast: 0, keepWeekly: 0 }, [1, 2]],
    ['all retained by weekly buckets', [0, 8, 15], { keepLast: 0, keepWeekly: 3 }, []],
    ['old duplicate week pruned', [70, 71, 72], { keepLast: 1, keepWeekly: 1 }, [71, 72]],
  ] as const)('%s', (_name, ages, policy, deletedAges) => {
    const backups = ages.map((age, index) => backup(`backup-${String(index)}`, age, 'critical'));
    const deleted = selectForDeletion(backups, policy, now, KEY);
    expect(deleted.map((item) => ageInDays(item.createdAt))).toEqual(deletedAges);
  });

  it('prunes critical and optional series independently', () => {
    const backups = [
      backup('critical-new', 0, 'critical'),
      backup('critical-old', 30, 'critical'),
      backup('optional-new', 0, 'optional'),
      backup('optional-old', 40, 'optional'),
    ];

    expect(selectForDeletion(backups, { keepLast: 1, keepWeekly: 0 }, now, KEY).map((item) => item.remoteId)).toEqual([
      'critical-old',
      'optional-old',
    ]);
  });

  it('never prunes archives written under another recovery key', () => {
    const backups = [
      backup('mine-new', 0, 'critical'),
      backup('mine-old', 30, 'critical'),
      { ...backup('other-old', 30, 'critical'), keyFingerprint: 'sha256:ffffffffffff' },
      { ...backup('unknown-old', 40, 'critical'), keyFingerprint: null },
    ];

    expect(selectForDeletion(backups, { keepLast: 1, keepWeekly: 0 }, now, KEY).map((item) => item.remoteId))
      .toEqual(['mine-old']);
  });
});

const backup = (remoteId: string, daysOld: number, tier: BackupTier): RemoteBackup => ({
  remoteId,
  name: `${remoteId}.avcbak`,
  tier,
  createdAt: new Date(now.getTime() - daysOld * 24 * 60 * 60 * 1000).toISOString(),
  sizeBytes: 100,
  appVersion: '1.0.0',
  schemaVersions: { globalCatalog: 15, photos: 5 },
  keyFingerprint: KEY,
});

const ageInDays = (createdAt: string): number => Math.round(
  (now.getTime() - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000),
);
