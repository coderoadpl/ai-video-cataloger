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
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
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
  const dictionary = useDictionary();
  const { isLoading, error, doctor, readiness, check } = usePrerequisites({ open, folder });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="prerequisites-modal">
      <DialogTitle>{dictionary.prerequisites.title}</DialogTitle>
      <DialogContent dividers>
        {isLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 4 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">{dictionary.prerequisites.checking}</Typography>
          </Box>
        ) : error !== null ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, py: 2 }}>
            <Alert severity="error">{formatAnalyzerError(error, dictionary.errors)}</Alert>
            <Button variant="outlined" onClick={check} data-testid="prerequisites-retry">
              {dictionary.prerequisites.retry}
            </Button>
          </Box>
        ) : doctor !== null && readiness !== null ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {doctor.allAvailable && readiness.ready ? (
              <Alert severity="success" data-testid="prerequisites-banner">
                {dictionary.prerequisites.allSatisfied}
              </Alert>
            ) : (
              <Alert severity="warning" data-testid="prerequisites-banner">
                {dictionary.prerequisites.missingCount(missingCount(doctor, readiness))}
              </Alert>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2">{dictionary.prerequisites.selectedFolderConfiguration}</Typography>
              <Alert
                severity={readiness.ready ? 'success' : 'warning'}
                data-testid="configured-readiness"
              >
                {readiness.ready
                  ? dictionary.prerequisites.selectedFolderReady
                  : readiness.suggestedAction
                    ?? dictionary.prerequisites.mustBeConfigured(readiness.missingPieces.map((piece) => piece.name).join(', '))}
              </Alert>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2">{dictionary.prerequisites.systemDependencies}</Typography>
              {doctor.dependencies.map((dependency) => (
                <DependencyRow key={dependency.name} dependency={dependency} dictionary={dictionary} />
              ))}
            </Box>
            {doctor.warnings.length === 0 ? null : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="subtitle2">{dictionary.prerequisites.warningsTitle}</Typography>
                {doctor.warnings.map((warning) => (
                  <Alert
                    key={`${warning.code}:${warning.message}`}
                    severity="warning"
                    data-testid="doctor-warning"
                    data-warning-code={warning.code}
                    sx={{ whiteSpace: 'pre-line' }}
                  >
                    {warning.message}
                  </Alert>
                ))}
              </Box>
            )}
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          {dictionary.prerequisites.close}
        </Button>
        <Button
          variant="outlined"
          onClick={check}
          disabled={isLoading || doctor === null || readiness === null}
          data-testid="prerequisites-check-again"
        >
          {dictionary.prerequisites.checkAgain}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const DependencyRow = ({ dependency, dictionary }: { dependency: DependencyStatus; dictionary: Dictionary }) => (
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
          {dependencyDisplayName(dictionary, dependency.name)}
        </Typography>
        {dependency.available && dependency.source !== null ? (
          <Chip size="small" label={dependency.source} variant="outlined" />
        ) : null}
      </Box>
      {dependency.available ? (
        <>
          <Typography variant="caption" sx={{ display: 'block' }}>
            {dependency.version === null ? dictionary.prerequisites.available : dictionary.prerequisites.version(dependency.version)}
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
            {dictionary.prerequisites.notFound}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {dependency.installHint}
          </Typography>
        </>
      )}
    </Box>
  </Box>
);
