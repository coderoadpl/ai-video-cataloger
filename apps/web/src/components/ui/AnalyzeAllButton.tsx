import { Button } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { PlayCircleIcon } from './icons.js';

interface AnalyzeAllButtonProps {
  pendingCount: number;
  onClick: () => void;
  disabled?: boolean;
  approximate?: boolean;
  testId?: string;
}

export const AnalyzeAllButton = ({
  pendingCount,
  onClick,
  disabled = false,
  approximate = false,
  testId = 'analyze-all-button',
}: AnalyzeAllButtonProps) => {
  const dictionary = useDictionary();
  return (
    <Button
      data-testid={testId}
      variant="contained"
      fullWidth
      size="small"
      disabled={disabled}
      startIcon={<PlayCircleIcon fontSize="small" />}
      onClick={onClick}
    >
      {approximate
        ? dictionary.batchToolbar.analyzeUpTo(pendingCount)
        : dictionary.batchToolbar.analyzeAll(pendingCount)}
    </Button>
  );
};
