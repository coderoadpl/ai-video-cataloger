import { Tooltip, type SvgIconProps } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { ContentCopyIcon } from './icons.js';
import { StatusBadge } from './StatusBadge.js';

const DuplicateGlyph = (props: SvgIconProps) => <ContentCopyIcon fontSize="inherit" {...props} />;

export const DuplicateBadge = ({ canonicalPath }: { canonicalPath: string }) => {
  const dictionary = useDictionary();
  return (
    <Tooltip title={dictionary.catalog.duplicateTooltip(canonicalPath)}>
      <span title={dictionary.catalog.duplicateTooltip(canonicalPath)}>
        <StatusBadge
          icon={<DuplicateGlyph />}
          label={dictionary.catalog.duplicateBadge}
          token="notTracked"
          testId="duplicate-badge"
        />
      </span>
    </Tooltip>
  );
};
