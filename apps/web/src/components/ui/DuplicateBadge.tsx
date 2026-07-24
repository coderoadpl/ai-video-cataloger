import { Chip, Tooltip, type SvgIconProps } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { ContentCopyIcon } from './icons.js';

const DuplicateGlyph = (props: SvgIconProps) => <ContentCopyIcon fontSize="inherit" {...props} />;

export const DuplicateBadge = ({ canonicalPath }: { canonicalPath: string }) => {
  const dictionary = useDictionary();
  return (
    <Tooltip title={dictionary.catalog.duplicateTooltip(canonicalPath)}>
      <Chip
        size="small"
        icon={<DuplicateGlyph />}
        label={dictionary.catalog.duplicateBadge}
        title={dictionary.catalog.duplicateTooltip(canonicalPath)}
        data-testid="duplicate-badge"
        sx={(theme) => ({
          bgcolor: theme.palette.action.selected,
          color: theme.palette.text.secondary,
          '& .MuiChip-icon': { color: 'inherit', fontSize: '0.9rem', marginLeft: '8px', marginRight: '3px' },
        })}
      />
    </Tooltip>
  );
};
