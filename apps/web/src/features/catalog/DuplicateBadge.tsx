import { Chip, Tooltip } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

export const DuplicateBadge = ({ canonicalPath }: { canonicalPath: string }) => {
  const dictionary = useDictionary();
  return (
    <Tooltip title={dictionary.catalog.duplicateTooltip(canonicalPath)}>
      <Chip
        size="small"
        label={dictionary.catalog.duplicateBadge}
        title={dictionary.catalog.duplicateTooltip(canonicalPath)}
        data-testid="duplicate-badge"
        sx={(theme) => ({ bgcolor: theme.palette.action.selected, color: theme.palette.text.secondary })}
      />
    </Tooltip>
  );
};
