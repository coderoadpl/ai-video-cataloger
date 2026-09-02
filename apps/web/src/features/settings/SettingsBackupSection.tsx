import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';

import type { BackupTier } from '@core/domain/index.js';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { BackupEnablementDialog } from './BackupEnablementDialog.js';
import { BackupRestoreDialog } from './BackupRestoreDialog.js';
import { formatArchiveSize, isRestorable, retentionInput, type RemoteBackupView } from './backup-model.js';
import { appErrorMessage, useBackupSection } from './use-backup.js';

interface SettingsBackupSectionProps {
  open: boolean;
}

export const SettingsBackupSection = ({ open }: SettingsBackupSectionProps) => {
  const dictionary = useDictionary();
  const backup = useBackupSection(open);
  const [stepperOpen, setStepperOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<RemoteBackupView | null>(null);
  const status = backup.status;
  const enabled = status?.enabled === true;
  const lastErrorMessage = status === undefined
    ? null
    : appErrorMessage(status.lastErrorCode === null ? null : { code: status.lastErrorCode, message: '' }, dictionary);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="settings-backup">
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{dictionary.backup.sectionTitle}</Typography>
      <Typography variant="caption">{dictionary.backup.sectionHelper}</Typography>

      {backup.error === null ? null : <Alert severity="error" data-testid="backup-error">{backup.error}</Alert>}
      {enabled && lastErrorMessage !== null ? (
        <Alert severity="warning" data-testid="backup-last-error">{lastErrorMessage}</Alert>
      ) : null}

      <FormControlLabel
        control={
          <Switch
            checked={enabled}
            data-testid="backup-enabled-switch"
            onChange={(event) => {
              if (event.target.checked) setStepperOpen(true);
              else backup.disable();
            }}
          />
        }
        label={dictionary.backup.enableLabel}
      />

      {status === undefined || !enabled ? null : (
        <>
          <Typography variant="caption" data-testid="backup-connection">
            {status.connected && (status.accountEmail ?? status.serviceAccountFingerprint) !== null
              ? dictionary.backup.statusConnected(status.accountEmail ?? status.serviceAccountFingerprint ?? '')
              : dictionary.backup.statusNotConnected}
          </Typography>
          <Typography variant="caption" data-testid="backup-last-success">
            {status.lastSuccessAt === null
              ? dictionary.backup.lastBackupNever
              : dictionary.backup.lastBackup(status.lastSuccessAt)}
          </Typography>
          <Typography variant="caption" data-testid="backup-next-due">
            {status.nextDueAt === null
              ? dictionary.backup.nextDueUnknown
              : dictionary.backup.nextDue(status.nextDueAt)}
          </Typography>

          <Box>
            <Button
              variant="outlined"
              size="small"
              onClick={backup.runNow}
              disabled={backup.isRunning}
              data-testid="backup-run-now"
            >
              {backup.isRunning ? dictionary.backup.running : dictionary.backup.runNow}
            </Button>
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={status.includeOptional}
                data-testid="backup-optional-tier-switch"
                onChange={(event) => backup.setIncludeOptional(event.target.checked)}
              />
            }
            label={dictionary.backup.optionalTierLabel}
          />
          <Typography variant="caption">{dictionary.backup.optionalTierHelper}</Typography>

          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField
              size="small"
              type="number"
              label={dictionary.backup.keepLastLabel}
              defaultValue={status.keepLast}
              onBlur={(event) =>
                backup.setRetention('backup_keep_last', retentionInput(event.target.value, 1, 90, status.keepLast))}
              slotProps={{ htmlInput: { 'data-testid': 'backup-keep-last', min: 1, max: 90 } }}
            />
            <TextField
              size="small"
              type="number"
              label={dictionary.backup.keepWeeklyLabel}
              defaultValue={status.keepWeekly}
              onBlur={(event) =>
                backup.setRetention('backup_keep_weekly', retentionInput(event.target.value, 0, 52, status.keepWeekly))}
              slotProps={{ htmlInput: { 'data-testid': 'backup-keep-weekly', min: 0, max: 52 } }}
            />
          </Box>
          <Typography variant="caption">{dictionary.backup.retentionHelper}</Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{dictionary.backup.listTitle}</Typography>
            <Select
              size="small"
              value={backup.tierFilter ?? 'all'}
              data-testid="backup-tier-filter"
              onChange={(event) => backup.setTierFilter(parseTierFilter(event.target.value))}
            >
              <MenuItem value="all">{dictionary.backup.tierFilterAll}</MenuItem>
              <MenuItem value="critical">{dictionary.backup.tierCritical}</MenuItem>
              <MenuItem value="optional">{dictionary.backup.tierOptional}</MenuItem>
            </Select>
          </Box>

          {backup.isListLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="caption">{dictionary.backup.listLoading}</Typography>
            </Box>
          ) : backup.backups.length === 0 ? (
            <Typography variant="caption" data-testid="backup-list-empty">{dictionary.backup.listEmpty}</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }} data-testid="backup-list">
              {backup.backups.map((remote) => {
                const restorable = isRestorable(remote, status.supportedSchemaVersions);
                return (
                  <Box
                    key={remote.remoteId}
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                    data-testid={`backup-row-${remote.remoteId}`}
                  >
                    <Typography variant="caption">
                      {`${tierLabel(remote.tier, dictionary)} · ${dictionary.backup.backupRow(
                        remote.createdAt,
                        formatArchiveSize(remote.sizeBytes),
                        remote.appVersion,
                      )}`}
                    </Typography>
                    {restorable ? (
                      <Button
                        size="small"
                        onClick={() => setRestoreTarget(remote)}
                        data-testid={`backup-restore-${remote.remoteId}`}
                      >
                        {dictionary.backup.restore}
                      </Button>
                    ) : (
                      <Typography variant="caption" color="text.secondary" data-testid={`backup-unsupported-${remote.remoteId}`}>
                        {dictionary.backup.restoreUnsupported(remote.appVersion)}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          )}
        </>
      )}

      <BackupEnablementDialog
        open={stepperOpen}
        includeOptional={status?.includeOptional ?? false}
        keepLast={status?.keepLast ?? 7}
        keepWeekly={status?.keepWeekly ?? 8}
        onClose={() => setStepperOpen(false)}
        onEnabled={() => setStepperOpen(false)}
      />

      <BackupRestoreDialog
        backup={restoreTarget}
        phase={backup.restorePhase}
        isRestoring={backup.isRestoring}
        error={backup.restoreError}
        onConfirm={backup.restore}
        onClose={() => setRestoreTarget(null)}
      />
    </Box>
  );
};

type Dictionary = ReturnType<typeof useDictionary>;

const tierLabel = (tier: BackupTier, dictionary: Dictionary): string =>
  tier === 'critical' ? dictionary.backup.tierCritical : dictionary.backup.tierOptional;

const parseTierFilter = (value: string): BackupTier | null => {
  if (value === 'critical') return 'critical';
  if (value === 'optional') return 'optional';
  return null;
};
