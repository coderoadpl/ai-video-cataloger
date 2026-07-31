import { ToggleButton, ToggleButtonGroup } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

export type AppMode = 'library' | 'analysis';

interface ModeSwitcherProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

export const ModeSwitcher = ({ mode, onModeChange }: ModeSwitcherProps) => {
  const dictionary = useDictionary();
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={mode}
      onChange={(_event, next: AppMode | null) => {
        if (next !== null) onModeChange(next);
      }}
      aria-label={dictionary.appFrame.modeSwitcherLabel}
      data-testid="mode-switcher"
    >
      <ToggleButton value="library" data-testid="mode-library">
        {dictionary.appFrame.modeLibrary}
      </ToggleButton>
      <ToggleButton value="analysis" data-testid="mode-analysis">
        {dictionary.appFrame.modeAnalysis}
      </ToggleButton>
    </ToggleButtonGroup>
  );
};
