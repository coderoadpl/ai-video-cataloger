import { ToggleButton, ToggleButtonGroup } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

export type AnalysisMedia = 'videos' | 'photos';

interface AnalysisMediaToggleProps {
  media: AnalysisMedia;
  onSelect: (media: AnalysisMedia) => void;
  fullWidth?: boolean;
}

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
      <ToggleButton value="videos" data-testid="analysis-media-videos">
        {dictionary.appFrame.mediaVideos}
      </ToggleButton>
      <ToggleButton value="photos" data-testid="analysis-media-photos">
        {dictionary.appFrame.mediaPhotos}
      </ToggleButton>
    </ToggleButtonGroup>
  );
};
