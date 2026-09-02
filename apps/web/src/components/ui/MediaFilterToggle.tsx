import { ToggleButton, ToggleButtonGroup } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { labelWithCount } from '../../lib/format.js';

export type MediaFilterValue = 'all' | 'video' | 'photo';

export interface MediaFilterCounts {
  all: number;
  video: number;
  photo: number;
}

interface MediaFilterToggleProps {
  value: MediaFilterValue;
  counts: MediaFilterCounts;
  onChange: (value: MediaFilterValue) => void;
  groupTestId: string;
  optionTestIdPrefix: string;
}

export const MediaFilterToggle = ({ value, counts, onChange, groupTestId, optionTestIdPrefix }: MediaFilterToggleProps) => {
  const dictionary = useDictionary();

  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_event, next: MediaFilterValue | null) => { if (next !== null) onChange(next); }}
      data-testid={groupTestId}
    >
      <ToggleButton value="all" data-testid={`${optionTestIdPrefix}-all`}>
        {labelWithCount(dictionary.library.mediaAll, counts.all)}
      </ToggleButton>
      <ToggleButton value="video" data-testid={`${optionTestIdPrefix}-video`}>
        {labelWithCount(dictionary.library.mediaVideo, counts.video)}
      </ToggleButton>
      <ToggleButton value="photo" data-testid={`${optionTestIdPrefix}-photo`}>
        {labelWithCount(dictionary.library.mediaPhoto, counts.photo)}
      </ToggleButton>
    </ToggleButtonGroup>
  );
};
