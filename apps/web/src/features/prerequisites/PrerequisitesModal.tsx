import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

import { CheckCircleIcon, ErrorIcon } from '../../components/ui/icons.js';
import {
  dependencyDisplayName,
  missingCount,
  type DependencyStatus,
} from './prerequisites-model.js';
import { usePrerequisites } from './use-prerequisites.js';

interface PrerequisitesModalProps {
  open: boolean;
  folder: string | null;
  onClose: () => void;
}

export const PrerequisitesModal = ({ open, folder, onClose }: PrerequisitesModalProps) => {
  const { isLoading, error, doctor, readiness, check } = usePrerequisites({ open, folder });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="prerequisites-modal">
      <DialogTitle>System Prerequisites</DialogTitle>
      <DialogContent dividers>
        {isLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 4 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Checking prerequisites…</Typography>
          </Box>
        ) : error !== null ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, py: 2 }}>
            <Alert severity="error">{error}</Alert>
            <Button variant="outlined" onClick={check} data-testid="prerequisites-retry">
              Retry
            </Button>
          </Box>
        ) : doctor !== null && readiness !== null ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {doctor.allAvailable && readiness.ready ? (
              <Alert severity="success" data-testid="prerequisites-banner">
                All prerequisites are satisfied!
              </Alert>
            ) : (
              <Alert severity="warning" data-testid="prerequisites-banner">
                {missingCount(doctor, readiness)} prerequisite(s) missing
              </Alert>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2">Selected folder configuration</Typography>
              <Alert
                severity={readiness.ready ? 'success' : 'warning'}
                data-testid="configured-readiness"
              >
                {readiness.ready
                  ? 'The selected folder is ready for analysis.'
                  : readiness.suggestedAction ?? `${readiness.missingPieces.map((piece) => piece.name).join(', ')} must be configured.`}
              </Alert>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2">System dependencies</Typography>
              {doctor.dependencies.map((dependency) => (
                <DependencyRow key={dependency.name} dependency={dependency} />
              ))}
            </Box>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="outlined"
          onClick={check}
          disabled={isLoading || doctor === null || readiness === null}
          data-testid="prerequisites-check-again"
        >
          Check Again
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const DependencyRow = ({ dependency }: { dependency: DependencyStatus }) => (
  <Box
    data-testid="dependency-row"
    data-dependency-name={dependency.name}
    sx={{ display: 'flex', gap: 1.5, p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider' }}
  >
    {dependency.available ? (
      <CheckCircleIcon fontSize="small" sx={{ color: 'status.completed.main', mt: 0.25 }} />
    ) : (
      <ErrorIcon fontSize="small" sx={{ color: 'error.main', mt: 0.25 }} />
    )}
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {dependencyDisplayName(dependency.name)}
        </Typography>
        {dependency.available && dependency.source !== null ? (
          <Chip size="small" label={dependency.source} variant="outlined" />
        ) : null}
      </Box>
      {dependency.available ? (
        <>
          <Typography variant="caption" sx={{ display: 'block' }}>
            {dependency.version === null ? 'Available' : `Version: ${dependency.version}`}
          </Typography>
          {dependency.path === null ? null : (
            <Typography variant="caption" color="text.secondary" noWrap title={dependency.path} sx={{ display: 'block' }}>
              {dependency.path}
            </Typography>
          )}
        </>
      ) : (
        <>
          <Typography variant="caption" color="error" sx={{ display: 'block' }}>
            Not found
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {dependency.installHint}
          </Typography>
        </>
      )}
    </Box>
  </Box>
);
