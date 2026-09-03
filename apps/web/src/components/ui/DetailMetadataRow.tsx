import { type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

interface DetailMetadataRowProps {
  icon: ReactNode;
  label: string | null;
  value: string;
  action?: ReactNode;
  testId?: string;
  valueTestId?: string;
  separator?: boolean;
  labelMinWidth?: number;
  valueNoWrap?: boolean;
}

export const DetailMetadataRow = ({
  icon,
  label,
  value,
  action,
  testId,
  valueTestId,
  separator = true,
  labelMinWidth,
  valueNoWrap = true,
}: DetailMetadataRowProps) => (
  <Box
    data-testid={testId}
    data-detail-metadata-row="true"
    sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}
  >
    <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
    {label === null ? null : (
      <Typography
        variant="body2"
        color="text.secondary"
        sx={labelMinWidth === undefined ? undefined : { minWidth: labelMinWidth, flexShrink: 0 }}
      >
        {label}{separator ? ':' : ''}
      </Typography>
    )}
    <Typography
      variant="body2"
      noWrap={valueNoWrap}
      sx={{ fontWeight: 500, minWidth: 0, ...(valueNoWrap ? {} : { overflowWrap: 'anywhere' }) }}
      title={value}
      data-testid={valueTestId}
    >
      {value}
    </Typography>
    {action}
  </Box>
);
