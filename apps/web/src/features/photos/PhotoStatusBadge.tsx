import { CircularProgress, type SvgIconProps } from '@mui/material';

import { StatusBadge } from '../../components/ui/StatusBadge.js';
import {
  CheckCircleIcon,
  ClockIcon,
  ContentCopyIcon,
  ErrorIcon,
  ImageNotSupportedIcon,
  WarningIcon,
} from '../../components/ui/icons.js';
import type { Dictionary } from '../../i18n/dictionary.js';
import type { StatusToken } from '../../theme.js';
import type { PhotoBadge } from './core/index.js';

export type PhotoStatus = PhotoBadge | 'pending' | 'analyzing';

const badgeLabel = (status: PhotoStatus, dictionary: Dictionary): string => {
  switch (status) {
    case 'analysed':
      return dictionary.photosSidebar.badgeAnalyzed;
    case 'duplicate':
      return dictionary.catalog.duplicateBadge;
    case 'proxyFailed':
      return dictionary.photosSidebar.badgeProxyFailed;
    case 'exifMissing':
      return dictionary.photosSidebar.badgeExifMissing;
    case 'missing':
      return dictionary.photosSidebar.badgeMissing;
    case 'pending':
      return dictionary.photosSidebar.badgePending;
    case 'analyzing':
      return dictionary.photosSidebar.badgeAnalyzing;
  }
};

const TOKEN_FOR_STATUS: Record<PhotoStatus, StatusToken> = {
  analysed: 'completed',
  duplicate: 'notTracked',
  proxyFailed: 'pending',
  exifMissing: 'notTracked',
  missing: 'error',
  pending: 'pending',
  analyzing: 'pending',
};

const BadgeIcon = ({ status, ...props }: { status: PhotoStatus } & SvgIconProps) => {
  switch (status) {
    case 'analysed':
      return <CheckCircleIcon fontSize="inherit" {...props} />;
    case 'duplicate':
      return <ContentCopyIcon fontSize="inherit" {...props} />;
    case 'proxyFailed':
      return <WarningIcon fontSize="inherit" {...props} />;
    case 'exifMissing':
      return <ImageNotSupportedIcon fontSize="inherit" {...props} />;
    case 'missing':
      return <ErrorIcon fontSize="inherit" {...props} />;
    case 'pending':
      return <ClockIcon fontSize="inherit" {...props} />;
    case 'analyzing':
      return <CircularProgress size={12} thickness={6} color="inherit" />;
  }
};

export const PhotoStatusBadge = ({
  status,
  dictionary,
  testId,
}: {
  status: PhotoStatus;
  dictionary: Dictionary;
  testId: string;
}) => (
  <StatusBadge
    icon={<BadgeIcon status={status} />}
    label={badgeLabel(status, dictionary)}
    token={TOKEN_FOR_STATUS[status]}
    testId={testId}
  />
);
