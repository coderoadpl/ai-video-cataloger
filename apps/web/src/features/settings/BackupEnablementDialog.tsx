import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';

import type { BackupProvider } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { apiErrorMessage } from '../../i18n/api-error-message.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { backupErrorMessage } from './backup-model.js';

interface BackupEnablementDialogProps {
  open: boolean;
  keepLast: number;
  keepWeekly: number;
  includeOptional: boolean;
  onClose: () => void;
  onEnabled: () => void;
}

export const BackupEnablementDialog = ({
  open,
  keepLast,
  keepWeekly,
  includeOptional,
  onClose,
  onEnabled,
}: BackupEnablementDialogProps) => {
  const dictionary = useDictionary();
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<BackupProvider>('google_oauth');
  const [sharedDriveId, setSharedDriveId] = useState('');
  const [keyJson, setKeyJson] = useState('');
  const [recoveryKeyPath, setRecoveryKeyPath] = useState<string | null>(null);
  const [recoveryKeyFingerprint, setRecoveryKeyFingerprint] = useState<string | null>(null);
  const [recoveryKeySaved, setRecoveryKeySaved] = useState(false);
  const connect = useMutation(actions.backupConnect);
  const testConnection = useMutation(actions.backupTest);
  const exportRecoveryKey = useMutation(actions.backupRecoveryKeyExport);
  const confirmRecoveryKey = useMutation(actions.backupRecoveryKeyConfirm);
  const enable = useMutation(actions.backupEnable);

  const connection = testConnection.data?.connection ?? connect.data?.connection ?? null;
  const failure = connect.error ?? testConnection.error ?? exportRecoveryKey.error ?? enable.error;
  const errorMessage = failure === null || failure === undefined
    ? null
    : backupErrorMessage(failure, dictionary.backup.errorMessages) ?? apiErrorMessage(failure, dictionary);

  const close = () => {
    setStep(0);
    setKeyJson('');
    setRecoveryKeyPath(null);
    setRecoveryKeyFingerprint(null);
    setRecoveryKeySaved(false);
    connect.reset();
    testConnection.reset();
    exportRecoveryKey.reset();
    enable.reset();
    onClose();
  };

  const runConnect = () => {
    connect.mutate({
      provider,
      keyJson: keyJson.length === 0 ? null : keyJson,
      sharedDriveId: sharedDriveId.length === 0 ? null : sharedDriveId,
    }, {
      onSuccess: () => {
        setKeyJson('');
        setStep(2);
      },
    });
  };

  const finish = () => {
    confirmRecoveryKey.mutate(undefined, {
      onSuccess: () => {
        enable.mutate({ includeOptional, keepLast, keepWeekly, runFirstBackup: true }, {
          onSuccess: () => {
            onEnabled();
            close();
          },
        });
      },
    });
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" data-testid="backup-stepper">
      <DialogTitle>{dictionary.backup.stepperTitle}</DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          <Step><StepLabel>{dictionary.backup.stepProvider}</StepLabel></Step>
          <Step><StepLabel>{dictionary.backup.stepConnect}</StepLabel></Step>
          <Step><StepLabel>{dictionary.backup.stepRecoveryKey}</StepLabel></Step>
        </Stepper>

        {errorMessage === null ? null : <Alert severity="error" data-testid="backup-stepper-error">{errorMessage}</Alert>}

        {step === 0 ? (
          <RadioGroup
            value={provider}
            onChange={(event) => setProvider(event.target.value === 'service_account' ? 'service_account' : 'google_oauth')}
          >
            <FormControlLabel
              value="google_oauth"
              control={<Radio data-testid="backup-provider-google" />}
              label={dictionary.backup.providerGoogle}
            />
            <Typography variant="caption" sx={{ ml: 4, mb: 1 }}>{dictionary.backup.providerGoogleHelper}</Typography>
            <FormControlLabel
              value="service_account"
              control={<Radio data-testid="backup-provider-service-account" />}
              label={dictionary.backup.providerServiceAccount}
            />
            <Typography variant="caption" sx={{ ml: 4 }}>{dictionary.backup.providerServiceAccountHelper}</Typography>
          </RadioGroup>
        ) : null}

        {step === 1 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {provider === 'service_account' ? (
              <>
                <TextField
                  fullWidth
                  size="small"
                  label={dictionary.backup.sharedDriveIdLabel}
                  helperText={dictionary.backup.sharedDriveIdHelper}
                  value={sharedDriveId}
                  onChange={(event) => setSharedDriveId(event.target.value)}
                  slotProps={{ htmlInput: { 'data-testid': 'backup-shared-drive-id' } }}
                />
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  size="small"
                  label={dictionary.backup.keyJsonLabel}
                  helperText={dictionary.backup.keyJsonHelper}
                  value={keyJson}
                  onChange={(event) => setKeyJson(event.target.value)}
                  slotProps={{ htmlInput: { 'data-testid': 'backup-key-json' } }}
                />
              </>
            ) : (
              <Typography variant="body2">{dictionary.backup.providerGoogleHelper}</Typography>
            )}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                onClick={runConnect}
                disabled={connect.isPending}
                data-testid="backup-connect"
              >
                {provider === 'service_account' ? dictionary.backup.importKeyJson : dictionary.backup.connectGoogle}
              </Button>
              <Button
                color="inherit"
                onClick={() => testConnection.mutate(undefined)}
                disabled={testConnection.isPending}
                data-testid="backup-test-connection"
              >
                {dictionary.backup.testConnection}
              </Button>
            </Box>
            {connection === null ? null : (
              <Alert severity="success" data-testid="backup-connection-report">
                {dictionary.backup.connectionReport(
                  connection.accountEmail ?? connection.driveName ?? '',
                  connection.folderName,
                )}
              </Alert>
            )}
          </Box>
        ) : null}

        {step === 2 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2">{dictionary.backup.recoveryKeyHelper}</Typography>
            <Box>
              <Button
                variant="contained"
                onClick={() => exportRecoveryKey.mutate(undefined, {
                  onSuccess: (exported) => {
                    setRecoveryKeyPath(exported.path);
                    setRecoveryKeyFingerprint(exported.fingerprint);
                  },
                })}
                disabled={exportRecoveryKey.isPending}
                data-testid="backup-export-recovery-key"
              >
                {dictionary.backup.exportRecoveryKey}
              </Button>
            </Box>
            {recoveryKeyPath === null || recoveryKeyFingerprint === null ? null : (
              <Box data-testid="backup-recovery-key-report">
                <Typography variant="body2">{dictionary.backup.recoveryKeyExported(recoveryKeyPath)}</Typography>
                <Typography variant="caption">
                  {dictionary.backup.recoveryKeyFingerprint(recoveryKeyFingerprint)}
                </Typography>
              </Box>
            )}
            <FormControlLabel
              control={
                <Checkbox
                  checked={recoveryKeySaved}
                  disabled={recoveryKeyPath === null}
                  onChange={(event) => setRecoveryKeySaved(event.target.checked)}
                  data-testid="backup-recovery-key-saved"
                />
              }
              label={dictionary.backup.recoveryKeySavedCheckbox}
            />
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={close} data-testid="backup-stepper-cancel">{dictionary.common.cancel}</Button>
        {step === 0 ? (
          <Button variant="contained" onClick={() => setStep(1)} data-testid="backup-stepper-next">
            {dictionary.common.next}
          </Button>
        ) : null}
        {step === 2 ? (
          <Button
            variant="contained"
            onClick={finish}
            disabled={recoveryKeyPath === null || !recoveryKeySaved || enable.isPending}
            data-testid="backup-finish"
          >
            {dictionary.backup.finish}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
};
