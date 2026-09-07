import { Chip, CircularProgress, type SvgIconProps } from '@mui/material';
import type { ReactElement } from 'react';

import { CHIP_ICON_SPACING, STATUS_CHIP_ICON_SX, type StatusToken } from '../../theme.js';

interface StatusBadgeProps {
  icon: ReactElement<SvgIconProps>;
  label: string;
  token: StatusToken;
  testId: string;
}

export const StatusBadgeSpinner = () => (
  <CircularProgress size={12} thickness={6} color="inherit" style={CHIP_ICON_SPACING} />
);

export const StatusBadge = ({ icon, label, token, testId }: StatusBadgeProps) => (
  <Chip
    size="small"
    icon={icon}
    label={label}
    data-testid={testId}
    data-status-badge=""
    sx={(theme) => ({
      bgcolor: theme.palette.status[token].soft,
      color: theme.palette.status[token].main,
      '& .MuiChip-icon': STATUS_CHIP_ICON_SX,
    })}
  />
);
