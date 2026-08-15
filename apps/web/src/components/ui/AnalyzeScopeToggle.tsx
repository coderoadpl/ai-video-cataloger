import { ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { type AnalyzeScope } from './ScopeAnalyzeToolbar.js';
import { sidebarToggleButtonSx } from './sidebar-toggle-row.js';

interface AnalyzeScopeToggleProps {
  scope: AnalyzeScope;
  onScopeChange: (scope: AnalyzeScope) => void;
  disabled?: boolean;
}

export const AnalyzeScopeToggle = ({ scope, onScopeChange, disabled = false }: AnalyzeScopeToggleProps) => {
  const dictionary = useDictionary();
  return (
    <Tooltip title={disabled ? dictionary.batchToolbar.scopeToggleDisabled : ''}>
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
