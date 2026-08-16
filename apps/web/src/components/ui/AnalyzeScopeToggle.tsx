import { ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { type AnalyzeScope } from './ScopeAnalyzeToolbar.js';
import { sidebarToggleButtonSx } from './sidebar-toggle-row.js';

export type AnalyzeScopeDisabledReason = 'busy' | 'no-video-subfolders' | 'no-photo-subfolders';

interface AnalyzeScopeToggleProps {
  scope: AnalyzeScope;
  onScopeChange: (scope: AnalyzeScope) => void;
  disabled?: boolean;
  disabledReason?: AnalyzeScopeDisabledReason | undefined;
}

export const AnalyzeScopeToggle = ({
  scope,
  onScopeChange,
  disabled = false,
  disabledReason,
}: AnalyzeScopeToggleProps) => {
  const dictionary = useDictionary();
  const disabledReasonCopy: Record<AnalyzeScopeDisabledReason, string> = {
    busy: dictionary.batchToolbar.scopeToggleBusy,
    'no-video-subfolders': dictionary.batchToolbar.scopeToggleNoVideoSubfolders,
    'no-photo-subfolders': dictionary.batchToolbar.scopeToggleNoPhotoSubfolders,
  };
  return (
    <Tooltip title={disabled && disabledReason !== undefined ? disabledReasonCopy[disabledReason] : ''}>
      <span>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={scope}
          disabled={disabled}
          onChange={(_event, next: AnalyzeScope | null) => {
            if (next !== null) onScopeChange(next);
          }}
          aria-label={dictionary.batchToolbar.analyzeScope}
        >
          <ToggleButton value="folder" data-testid="scope-folder" sx={sidebarToggleButtonSx}>
            {dictionary.batchToolbar.thisFolder}
          </ToggleButton>
          <ToggleButton value="tree" data-testid="scope-tree" sx={sidebarToggleButtonSx}>
            {dictionary.batchToolbar.wholeTree}
          </ToggleButton>
        </ToggleButtonGroup>
      </span>
    </Tooltip>
  );
};
