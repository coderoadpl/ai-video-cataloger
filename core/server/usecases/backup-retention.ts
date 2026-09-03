import type { BackupTier, RemoteBackup } from '@core/domain/index.js';

export interface BackupRetentionPolicy {
  keepLast: number;
  keepWeekly: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const selectForDeletion = (
  backups: readonly RemoteBackup[],
  policy: BackupRetentionPolicy,
  now: Date,
  keyFingerprint: string,
): RemoteBackup[] => {
  const own = backups.filter((backup) => backup.keyFingerprint === keyFingerprint);
  const keep = new Set<string>();
  for (const tier of ['critical', 'optional'] satisfies readonly BackupTier[]) {
    const series = own
      .filter((backup) => backup.tier === tier)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    for (const backup of series.slice(0, Math.max(0, policy.keepLast))) keep.add(backup.remoteId);
    const currentWeek = isoWeekStart(now).getTime();
    const weekly = new Set<number>();
    for (const backup of series) {
      const week = isoWeekStart(new Date(backup.createdAt)).getTime();
      const age = Math.floor((currentWeek - week) / WEEK_MS);
      if (age < 0 || age >= policy.keepWeekly || weekly.has(week)) continue;
      weekly.add(week);
      keep.add(backup.remoteId);
    }
    const newest = series[0];
    if (newest !== undefined) keep.add(newest.remoteId);
  }
  return own.filter((backup) => !keep.has(backup.remoteId));
};

const isoWeekStart = (date: Date): Date => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  return start;
};
