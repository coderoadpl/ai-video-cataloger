import { Chip, CircularProgress } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import type { Dictionary } from '../../i18n/dictionary.js';
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

const labelFor = (status: VideoStatusValue, dictionary: Dictionary): string => {
  if (isIntermediate(status)) return dictionary.videoStatus.incomplete;
  switch (status) {
    case 'completed':
      return dictionary.videoStatus.completed;
    case 'error':
      return dictionary.videoStatus.error;
    case 'pending':
      return dictionary.videoStatus.pending;
    case 'not_tracked':
      return dictionary.videoStatus.notTracked;
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
  const dictionary = useDictionary();
  if (analyzing) {
    return (
      <Chip
        size="small"
        icon={<CircularProgress size={12} thickness={6} color="inherit" />}
        label={dictionary.videoStatus.processing}
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
      label={labelFor(status, dictionary)}
      sx={(theme) => ({
        bgcolor: theme.palette.status[token].soft,
        color: theme.palette.status[token].main,
        '& .MuiChip-icon': { color: 'inherit', fontSize: '0.9rem' },
      })}
    />
  );
};
