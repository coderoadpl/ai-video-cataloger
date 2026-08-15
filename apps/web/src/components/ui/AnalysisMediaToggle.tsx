import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { sidebarToggleButtonSx } from './sidebar-toggle-row.js';

export type AnalysisMedia = 'videos' | 'photos';

interface AnalysisMediaToggleProps {
  media: AnalysisMedia;
  onSelect: (media: AnalysisMedia) => void;
  fullWidth?: boolean;
}

const labelSx = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

export const AnalysisMediaToggle = ({ media, onSelect, fullWidth = false }: AnalysisMediaToggleProps) => {
  const dictionary = useDictionary();
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
      <ToggleButton
        value="videos"
        data-testid="analysis-media-videos"
        title={dictionary.appFrame.mediaVideos}
        sx={sidebarToggleButtonSx}
      >
        <Box component="span" sx={labelSx}>{dictionary.appFrame.mediaVideos}</Box>
      </ToggleButton>
      <ToggleButton
        value="photos"
        data-testid="analysis-media-photos"
        title={dictionary.appFrame.mediaPhotos}
        sx={sidebarToggleButtonSx}
      >
        <Box component="span" sx={labelSx}>{dictionary.appFrame.mediaPhotos}</Box>
      </ToggleButton>
    </ToggleButtonGroup>
  );
};
