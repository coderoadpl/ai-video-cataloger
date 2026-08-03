import { Box } from '@mui/material';

import { aspectRatioIndicatorKind } from '../../lib/aspect-ratio-indicator.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { CropPortraitIcon, PanoramaIcon } from './icons.js';

interface AspectRatioIndicatorProps {
  width: number | null;
  height: number | null;
  testId: string;
}

export const AspectRatioIndicator = ({ width, height, testId }: AspectRatioIndicatorProps) => {
  const dictionary = useDictionary();
  const kind = aspectRatioIndicatorKind(width, height);
  if (kind === null) return null;
  const Icon = kind === 'portrait' ? CropPortraitIcon : PanoramaIcon;
  const label = kind === 'portrait' ? dictionary.common.aspectPortraitLabel : dictionary.common.aspectPanoramaLabel;

  return (
    <Box
      data-testid={testId}
      role="img"
      aria-label={label}
      sx={{
        position: 'absolute',
        bottom: 4,
        right: 4,
        width: 20,
        height: 20,
        borderRadius: '50%',
        bgcolor: 'background.paper',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon sx={{ fontSize: 14, color: 'text.secondary' }} />
    </Box>
  );
};
