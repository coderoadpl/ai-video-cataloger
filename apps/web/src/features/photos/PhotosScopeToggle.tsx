import { ToggleButton, ToggleButtonGroup } from '@mui/material';

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
      <ToggleButton value="folder" data-testid="photos-scope-folder">
        {dictionary.photosSidebar.scopeThisFolder}
      </ToggleButton>
      <ToggleButton value="all" data-testid="photos-scope-all">
        {dictionary.photosSidebar.scopeAllFolders}
      </ToggleButton>
    </ToggleButtonGroup>
  );
};
