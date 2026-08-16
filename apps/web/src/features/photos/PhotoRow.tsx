import { alpha, Box, CircularProgress, ListItemButton, Tooltip, Typography } from '@mui/material';

import type { Dictionary } from '../../i18n/dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media-url.js';
import { photoBadges, type PhotoListItem } from './core/index.js';
import { PhotoStatusBadge } from './PhotoStatusBadge.js';

export const PHOTO_ROW_THUMB_BOX = 56;

export const PhotoRow = ({
  item,
  selected,
  isProcessing,
  onSelect,
  dictionary,
}: {
  item: PhotoListItem;
  selected: boolean;
  isProcessing: boolean;
  onSelect: () => void;
  dictionary: Dictionary;
}) => {
  const thumbPath = item.thumbPath;
  return (
    <ListItemButton
      selected={selected}
      onClick={onSelect}
      title={item.currentPath}
      data-testid="photos-sidebar-row"
      data-processing={isProcessing ? 'true' : 'false'}
      sx={{ alignItems: 'center', gap: 1.25, borderRadius: 1, py: 1 }}
    >
      <Box sx={{ position: 'relative', width: PHOTO_ROW_THUMB_BOX, height: PHOTO_ROW_THUMB_BOX, flexShrink: 0, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
        {thumbPath === null ? null : (
          <Box component="img" loading="lazy" alt={item.fileName} src={mediaUrl(thumbPath, item.fingerprint)} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {isProcessing ? (
          <Tooltip title={dictionary.photosSidebar.badgeAnalyzing}>
            <Box
              data-testid="photos-sidebar-row-inflight"
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: (theme) => alpha(theme.palette.common.black, 0.35),
              }}
            >
              <CircularProgress size={20} sx={{ color: 'common.white' }} />
            </Box>
          </Tooltip>
        ) : null}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
          {item.fileName}
        </Typography>
        <Typography variant="caption" noWrap>
          {formatCapturedAt(item.capturedAt, dictionary.locale) ?? dictionary.photos.unknownDate}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {photoBadges(item).map((badge) => (
            <PhotoStatusBadge
              key={badge}
              status={badge}
              dictionary={dictionary}
              testId={`photos-sidebar-badge-${badge}`}
            />
          ))}
        </Box>
      </Box>
    </ListItemButton>
  );
};
