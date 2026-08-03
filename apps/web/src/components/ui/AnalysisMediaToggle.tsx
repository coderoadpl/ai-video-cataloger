import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

export type AnalysisMedia = 'videos' | 'photos';

interface AnalysisMediaToggleProps {
  media: AnalysisMedia;
  onSelect: (media: AnalysisMedia) => void;
  fullWidth?: boolean;
  dense?: boolean;
}

const labelSx = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

export const AnalysisMediaToggle = ({ media, onSelect, fullWidth = false, dense = false }: AnalysisMediaToggleProps) => {
  const dictionary = useDictionary();
  const buttonSx = { minWidth: 0, ...(dense ? { px: 0.75, fontSize: '0.75rem' } : undefined) };
  return (
    <ToggleButtonGroup
      exclusive
      fullWidth={fullWidth}
      size="small"
      value={media}
      onChange={(_event, next: AnalysisMedia | null) => {
        if (next !== null) onSelect(next);
      }}
      aria-label={dictionary.appFrame.mediaToggleLabel}
    >
      <ToggleButton value="videos" data-testid="analysis-media-videos" sx={buttonSx}>
        <Box component="span" sx={labelSx}>{dictionary.appFrame.mediaVideos}</Box>
      </ToggleButton>
      <ToggleButton value="photos" data-testid="analysis-media-photos" sx={buttonSx}>
        <Box component="span" sx={labelSx}>{dictionary.appFrame.mediaPhotos}</Box>
      </ToggleButton>
    </ToggleButtonGroup>
  );
};
