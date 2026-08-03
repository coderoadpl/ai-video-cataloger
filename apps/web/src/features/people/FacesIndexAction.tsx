import { Alert, Box, Button } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import type { AddLogLine } from '../../components/ui/use-terminal-log.js';
import { useFacesIndex } from './use-faces-index.js';

interface FacesIndexActionProps {
  active: boolean;
  folder: string | null;
  addLine: AddLogLine;
  lockReason?: string | undefined;
}

export const FacesIndexAction = ({ active, folder, addLine, lockReason }: FacesIndexActionProps) => {
  const dictionary = useDictionary();
  const facesIndex = useFacesIndex({ active, folder, addLine });
  const mutationsBlocked = lockReason !== undefined;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
      <Button
        variant="outlined"
        size="small"
        disabled={folder === null || facesIndex.isBusy || facesIndex.facesEnabled !== true || facesIndex.artifactsReady !== true || mutationsBlocked}
        title={lockReason}
        onClick={facesIndex.indexFaces}
        data-testid="people-index"
      >
        {dictionary.people.indexFaces}
      </Button>
      {facesIndex.actionError === null ? null : (
        <Alert severity="error" data-testid="people-index-error">
          {formatAnalyzerError(facesIndex.actionError, dictionary.errors)}
        </Alert>
      )}
    </Box>
  );
};
