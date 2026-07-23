import { useEffect } from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';

import { CheckCircleIcon, ErrorIcon, WarningIcon } from '../../components/ui/icons.js';
import type { ChecklistRow, ChecklistStatus } from './readiness-checklist.js';
import type { WizardController } from './use-wizard.js';

const StatusIcon = ({ status }: { status: ChecklistStatus }) => {
  if (status === 'ok') return <CheckCircleIcon fontSize="small" sx={{ color: 'status.completed.main', mt: 0.25 }} />;
  if (status === 'warning') return <WarningIcon fontSize="small" sx={{ color: 'status.pending.main', mt: 0.25 }} />;
  return <ErrorIcon fontSize="small" sx={{ color: 'error.main', mt: 0.25 }} />;
};

const ChecklistItem = ({
  row,
  onAction,
}: {
  row: ChecklistRow;
  onAction: WizardController['applyChecklistAction'];
}) => {
  const action = row.action;
  return (
    <Box
      data-testid="readiness-row"
      data-row-id={row.id}
      data-status={row.status}
      sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}
    >
      <StatusIcon status={row.status} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {row.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {row.description}
        </Typography>
      </Box>
      {action !== null && row.actionLabel !== null ? (
        <Button
          size="small"
          variant="outlined"
          data-testid="readiness-row-action"
          onClick={() => onAction(action)}
        >
          {row.actionLabel}
        </Button>
      ) : null}
    </Box>
  );
};

export const ReadinessStep = ({ controller }: { controller: WizardController }) => {
  const { readiness, readinessChecklist, isCheckingReadiness, checkReadiness, applyChecklistAction } = controller;
  useEffect(() => {
    if (readiness === null && !isCheckingReadiness) checkReadiness();
  }, [readiness, isCheckingReadiness, checkReadiness]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-readiness">
      <Typography variant="h2">Final check</Typography>
      {isCheckingReadiness || readiness === null ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }} data-testid="readiness-checking">
          <CircularProgress size={18} />
          <Typography variant="body2">Checking your configuration…</Typography>
        </Box>
      ) : (
        <>
          {readiness.ready ? (
            <Alert severity="success" data-testid="readiness-ready">
              Everything is configured. You are ready to analyze videos.
            </Alert>
          ) : (
            <Alert severity="warning" data-testid="readiness-not-ready">
              Some checks need attention. Use the actions below to fix them.
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }} data-testid="readiness-checklist">
            {readinessChecklist.map((row) => (
              <ChecklistItem key={row.id} row={row} onAction={applyChecklistAction} />
            ))}
          </Box>
        </>
      )}
    </Box>
  );
};
