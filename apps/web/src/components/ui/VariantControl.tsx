import { type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

import { type Dictionary } from '../../i18n/dictionary.js';

interface VariantControlProps {
  control: ReactNode;
  caption: ReactNode;
  testId?: string;
  captionTestId?: string;
}

export const VariantControl = ({ control, caption, testId, captionTestId }: VariantControlProps) => (
  <Box data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
    {control}
    <Typography variant="caption" color="text.secondary" data-testid={captionTestId}>
      {caption}
    </Typography>
  </Box>
);

export const humanizedVariantLanguage = (language: string, dictionary: Dictionary): string => {
  switch (language) {
    case 'auto':
      return dictionary.photos.provenanceLanguageAuto;
    case 'en':
      return dictionary.photos.provenanceLanguageEnglish;
    case 'pl':
      return dictionary.photos.provenanceLanguagePolish;
    default:
      return language;
  }
};
