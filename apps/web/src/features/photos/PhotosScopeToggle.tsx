import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import type { PhotosAnalysisScope } from './use-photos-analysis.js';

interface PhotosScopeToggleProps {
  scope: PhotosAnalysisScope;
  onScopeChange: (scope: PhotosAnalysisScope) => void;
}

export const PhotosScopeToggle = ({ scope, onScopeChange }: PhotosScopeToggleProps) => {
  const dictionary = useDictionary();
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      fullWidth
      value={scope}
      onChange={(_event, next: PhotosAnalysisScope | null) => {
        if (next !== null) onScopeChange(next);
      }}
    >
      <ToggleButton value="folder" data-testid="photos-scope-folder" title={dictionary.photosSidebar.scopeThisFolder} sx={{ minWidth: 0 }}>
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dictionary.photosSidebar.scopeThisFolder}
        </Box>
      </ToggleButton>
      <ToggleButton value="all" data-testid="photos-scope-all" title={dictionary.photosSidebar.scopeAllFolders} sx={{ minWidth: 0 }}>
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dictionary.photosSidebar.scopeAllFolders}
        </Box>
      </ToggleButton>
    </ToggleButtonGroup>
  );
};
