import { type ReactElement } from 'react';
import { Box, Typography, type SvgIconProps } from '@mui/material';

import type { StatusToken } from '../../theme.js';

interface TileBadgeProps {
  icon: ReactElement<SvgIconProps>;
  label: string;
  token: StatusToken;
  testId: string;
  placement: 'top-right' | 'bottom-left';
  iconOnly?: boolean;
}

const PLACEMENT_SX = {
  'top-right': { top: 4, right: 4 },
  'bottom-left': { bottom: 4, left: 4 },
} as const;

export const TileBadge = ({ icon, label, token, testId, placement, iconOnly = false }: TileBadgeProps) => (
  <Box
    data-testid={testId}
    {...(iconOnly ? { role: 'img', 'aria-label': label } : {})}
    sx={(theme) => ({
      position: 'absolute',
      ...PLACEMENT_SX[placement],
      display: 'flex',
      alignItems: 'center',
      gap: iconOnly ? 0 : 0.5,
      px: iconOnly ? 0.5 : 0.75,
      py: 0.25,
      borderRadius: 1,
      bgcolor: theme.palette.status[token].soft,
      color: theme.palette.status[token].main,
      '& .MuiSvgIcon-root': { fontSize: 14, color: 'inherit' },
    })}
  >
    {icon}
    {iconOnly ? null : (
      <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 600, lineHeight: 1.2 }}>
        {label}
      </Typography>
    )}
  </Box>
);
