import { Chip, CircularProgress } from '@mui/material';

import type { StatusToken } from '../../theme.js';
import { CheckCircleIcon, ClockIcon, ErrorIcon, FilmIcon, WarningIcon } from './icons.js';

export type VideoStatusValue =
  | 'pending'
  | 'frames_extracted'
  | 'audio_extracted'
  | 'transcribed'
  | 'analyzed'
  | 'completed'
  | 'error'
  | 'not_tracked';

const TOKEN_FOR: Record<VideoStatusValue, StatusToken> = {
  completed: 'completed',
  error: 'error',
  pending: 'pending',
  frames_extracted: 'inProgress',
  audio_extracted: 'inProgress',
  transcribed: 'inProgress',
  analyzed: 'inProgress',
  not_tracked: 'notTracked',
};

type IntermediateStatus = 'frames_extracted' | 'audio_extracted' | 'transcribed' | 'analyzed';

const isIntermediate = (status: VideoStatusValue): status is IntermediateStatus =>
  status === 'frames_extracted' ||
  status === 'audio_extracted' ||
  status === 'transcribed' ||
  status === 'analyzed';

const labelFor = (status: VideoStatusValue, variant: BadgeVariant): string => {
  if (isIntermediate(status)) return 'Incomplete';
  switch (status) {
    case 'completed':
      return variant === 'details' ? 'Completed' : 'Done';
    case 'error':
      return 'Error';
    case 'pending':
      return 'Pending';
    case 'not_tracked':
      return 'Not Tracked';
  }
};

const StatusGlyph = ({ status }: { status: VideoStatusValue }) => {
  if (isIntermediate(status)) return <WarningIcon fontSize="inherit" />;
  switch (status) {
    case 'completed':
      return <CheckCircleIcon fontSize="inherit" />;
    case 'error':
      return <ErrorIcon fontSize="inherit" />;
    case 'pending':
      return <ClockIcon fontSize="inherit" />;
    case 'not_tracked':
      return <FilmIcon fontSize="inherit" />;
  }
};

type BadgeVariant = 'list' | 'details';

interface VideoStatusBadgeProps {
  status: VideoStatusValue;
  analyzing?: boolean;
  variant?: BadgeVariant;
}

export const VideoStatusBadge = ({
  status,
  analyzing = false,
  variant = 'list',
}: VideoStatusBadgeProps) => {
  if (analyzing) {
    return (
      <Chip
        size="small"
        icon={<CircularProgress size={12} thickness={6} color="inherit" />}
        label="Processing"
        sx={(theme) => ({
          bgcolor: theme.palette.status.pending.soft,
          color: theme.palette.status.pending.main,
          '& .MuiChip-icon': { color: 'inherit' },
        })}
      />
    );
  }

  if (status === 'not_tracked' && variant === 'list') return null;

  const token = TOKEN_FOR[status];

  return (
    <Chip
      size="small"
      icon={<StatusGlyph status={status} />}
      label={labelFor(status, variant)}
      sx={(theme) => ({
        bgcolor: theme.palette.status[token].soft,
        color: theme.palette.status[token].main,
        '& .MuiChip-icon': { color: 'inherit', fontSize: '0.9rem' },
      })}
    />
  );
};
