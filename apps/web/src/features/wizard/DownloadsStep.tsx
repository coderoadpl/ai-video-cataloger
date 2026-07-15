import { Alert, Box, LinearProgress, Typography } from '@mui/material';

import type { DownloadProgress, WizardController } from './use-wizard.js';

const DownloadRow = ({ task }: { task: DownloadProgress }) => (
  <Box data-testid="download-task">
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography variant="body2">{task.label}</Typography>
      <Typography variant="caption">
        {task.status === 'done' ? 'Done' : task.status === 'error' ? 'Failed' : `${task.percentage}%`}
      </Typography>
    </Box>
    <LinearProgress
      variant="determinate"
      value={task.percentage}
      color={task.status === 'error' ? 'error' : 'primary'}
    />
  </Box>
);

export const DownloadsStep = ({ controller }: { controller: WizardController }) => {
  const live = controller.downloads;
  const preview: DownloadProgress[] = controller.plannedDownloadLabels.map((label) => ({
    label,
    percentage: 0,
    status: 'running',
  }));
  const tasks = live.length > 0 ? live : preview;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="wizard-step-downloads">
      <Typography variant="h2">Install what you chose</Typography>
      {tasks.length === 0 ? (
        <Typography variant="body2" data-testid="downloads-none">
          Nothing to download — your selections are already available. Continue to verify readiness.
        </Typography>
      ) : (
        tasks.map((task, index) => <DownloadRow key={`${task.label}-${index}`} task={task} />)
      )}
      {controller.validationMessage !== null && !controller.isDownloading ? (
        <Alert severity="error" data-testid="downloads-error">
          {controller.validationMessage}
        </Alert>
      ) : null}
    </Box>
  );
};
