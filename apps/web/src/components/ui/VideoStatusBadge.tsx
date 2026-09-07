import { type SvgIconProps } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import type { Dictionary } from '../../i18n/dictionary.js';
import type { StatusToken } from '../../theme.js';
import { CheckCircleIcon, ClockIcon, ErrorIcon, FilmIcon, WarningIcon } from './icons.js';
import { StatusBadge, StatusBadgeSpinner } from './StatusBadge.js';

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
  if (isIntermediate(status)) return dictionary.mediaStatus.incomplete;
  switch (status) {
    case 'completed':
      return dictionary.mediaStatus.analyzed;
    case 'error':
      return dictionary.mediaStatus.failed;
    case 'pending':
      return dictionary.mediaStatus.pending;
    case 'not_tracked':
      return dictionary.mediaStatus.notTracked;
  }
};

const StatusGlyph = ({ status, ...props }: { status: VideoStatusValue } & SvgIconProps) => {
  if (isIntermediate(status)) return <WarningIcon fontSize="inherit" {...props} />;
  switch (status) {
    case 'completed':
      return <CheckCircleIcon fontSize="inherit" {...props} />;
    case 'error':
      return <ErrorIcon fontSize="inherit" {...props} />;
    case 'pending':
      return <ClockIcon fontSize="inherit" {...props} />;
    case 'not_tracked':
      return <FilmIcon fontSize="inherit" {...props} />;
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
      <StatusBadge
        icon={<StatusBadgeSpinner />}
        label={dictionary.mediaStatus.processing}
        token="pending"
        testId="video-status-badge"
      />
    );
  }

  if (status === 'pending' && variant === 'details') return null;
  if (status === 'not_tracked' && variant === 'list') return null;

  return (
    <StatusBadge
      icon={<StatusGlyph status={status} />}
      label={labelFor(status, dictionary)}
      token={TOKEN_FOR[status]}
      testId="video-status-badge"
    />
  );
};
