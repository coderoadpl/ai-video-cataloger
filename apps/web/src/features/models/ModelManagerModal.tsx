import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from '@mui/material';

import type { WhisperModelName } from '@core/domain/index.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { StorageIcon } from '../../components/ui/icons.js';
import { useDictionary } from '../../i18n/use-dictionary.js';

import { DeleteModelDialog } from './DeleteModelDialog.js';
import { LocalAiSection } from './LocalAiSection.js';
import { WhisperModelRow } from './WhisperModelRow.js';
import { useLocalAi } from './use-local-ai.js';
import { useWhisperModels } from './use-whisper-models.js';
import { useWhisperRuntime } from './use-whisper-runtime.js';

interface ModelManagerModalProps {
  open: boolean;
  onClose: () => void;
  addLine: AddLogLine;
  intervalMs?: number;
}

export const ModelManagerModal = ({ open, onClose, addLine, intervalMs }: ModelManagerModalProps) => {
  const dictionary = useDictionary();
  const whisper = useWhisperModels({ open, addLine, ...(intervalMs === undefined ? {} : { intervalMs }) });
  const runtime = useWhisperRuntime({ open, addLine, ...(intervalMs === undefined ? {} : { intervalMs }) });
  const localAi = useLocalAi({ open, addLine, ...(intervalMs === undefined ? {} : { intervalMs }) });
  const [deleteTarget, setDeleteTarget] = useState<WhisperModelName | null>(null);

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="model-manager-modal">
        <DialogTitle>{dictionary.models.managerTitle}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography variant="h2">{dictionary.models.whisperModelsTitle}</Typography>
              {runtime.isLoading ? (
                <Typography variant="caption">{dictionary.models.checkingWhisperRuntime}</Typography>
              ) : runtime.error !== null ? (
                <Alert severity="error">{runtime.error}</Alert>
              ) : runtime.available ? (
                <Alert severity="success" data-testid="whisper-runtime-status">
                  {dictionary.models.runtimeStatus(runtime.source, runtime.path)}
                </Alert>
              ) : (
                <Alert
                  severity="warning"
                  action={
                    <Button
                      size="small"
                      onClick={runtime.install}
                      disabled={!runtime.buildToolsAvailable || runtime.isInstalling}
                      data-testid="whisper-runtime-install"
                    >
                      {runtime.isInstalling ? dictionary.models.installing : dictionary.models.install}
                    </Button>
                  }
                >
                  {runtime.buildToolsAvailable
                    ? dictionary.models.runtimeNotInstalled
                    : dictionary.models.managedBuildRequires(runtime.missingBuildTools.join(' and '))}
                </Alert>
              )}
              {whisper.isLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2">{dictionary.models.loadingModels}</Typography>
                </Box>
              ) : whisper.error !== null ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Alert severity="error">{whisper.error}</Alert>
                  <Button size="small" onClick={whisper.retry}>
                    {dictionary.models.retry}
                  </Button>
                </Box>
              ) : (
                <>
                  <Box
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}
                    data-testid="whisper-disk-usage"
                  >
                    <StorageIcon fontSize="small" />
                    <Typography variant="caption">{dictionary.models.diskSpaceUsed(whisper.diskUsageLabel)}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {whisper.models.map((model) => (
                      <WhisperModelRow
                        key={model.name}
                        model={model}
                        activating={whisper.activatingModel === model.name}
                        deleting={whisper.deletingModel === model.name}
                        downloadPercentage={
                          whisper.downloadProgress?.modelName === model.name
                            ? whisper.downloadProgress.percentage
                            : null
                        }
                        disabled={whisper.isBusy}
                        onActivate={() => whisper.activate(model.name)}
                        onDownload={() => whisper.download(model.name)}
                        onDelete={() => setDeleteTarget(model.name)}
                      />
                    ))}
                  </Box>
                </>
              )}
            </Box>

            <Divider />

            <LocalAiSection state={localAi} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={onClose} data-testid="model-manager-close">
            {dictionary.common.close}
          </Button>
        </DialogActions>
      </Dialog>

      <DeleteModelDialog
        open={deleteTarget !== null}
        modelName={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget !== null) whisper.remove(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </>
  );
};
