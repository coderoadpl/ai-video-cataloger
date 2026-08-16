import { Alert, Box, Button, Tooltip } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { useFacesIndex } from './use-faces-index.js';

interface FacesIndexActionProps {
  active: boolean;
  folder: string | null;
  addLine: AddLogLine;
  lockReason?: string | undefined;
  hasAnalyzedPhotos: boolean;
}

export const FacesIndexAction = ({ active, folder, addLine, lockReason, hasAnalyzedPhotos }: FacesIndexActionProps) => {
  const dictionary = useDictionary();
  const facesIndex = useFacesIndex({ active, folder, addLine });
  const mutationsBlocked = lockReason !== undefined;
  const analyzedPhotosMissing = folder !== null && !hasAnalyzedPhotos;
  const disabledTitle = lockReason ?? (analyzedPhotosMissing ? dictionary.people.indexFacesNoAnalyzedPhotos : undefined);
  const disabled = folder === null
    || facesIndex.isBusy
    || facesIndex.facesEnabled !== true
    || facesIndex.artifactsReady !== true
    || mutationsBlocked
    || analyzedPhotosMissing;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
      <Tooltip title={disabledTitle ?? ''}>
        <Box component="span" sx={{ width: '100%' }}>
          <Button
            variant="outlined"
            size="small"
            fullWidth
            disabled={disabled}
            title={disabledTitle}
            onClick={facesIndex.indexFaces}
            data-testid="people-index"
          >
            {dictionary.people.indexFaces}
          </Button>
        </Box>
      </Tooltip>
      {facesIndex.actionError === null ? null : (
        <Alert severity="error" data-testid="people-index-error">
          {formatAnalyzerError(facesIndex.actionError, dictionary.errors)}
        </Alert>
      )}
    </Box>
  );
};
