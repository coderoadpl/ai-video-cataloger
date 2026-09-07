import { type MouseEvent } from 'react';
import { Box, ListItemButton, Typography } from '@mui/material';

import { MediaThumbnail } from '../../components/ui/MediaThumbnail.js';
import type { Dictionary } from '../../i18n/dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { PHOTO_ROW_HEIGHT, PHOTO_ROW_THUMB_BOX } from '../../theme.js';
import { photoBadges, type PhotoListItem } from './core/index.js';
import { PhotoStatusBadge } from './PhotoStatusBadge.js';

export const PhotoRow = ({
  item,
  selected,
  isProcessing,
  onSelect,
  onContextMenu,
  dictionary,
}: {
  item: PhotoListItem;
  selected: boolean;
  isProcessing: boolean;
  onSelect: () => void;
  onContextMenu: (event: MouseEvent, path: string) => void;
  dictionary: Dictionary;
}) => (
  <ListItemButton
    selected={selected}
    onClick={onSelect}
    onContextMenu={(event) => onContextMenu(event, item.currentPath)}
    title={item.currentPath}
    data-testid="photos-sidebar-row"
    data-processing={isProcessing ? 'true' : 'false'}
    sx={{ alignItems: 'center', gap: 1.25, borderRadius: 1, py: 1, height: PHOTO_ROW_HEIGHT }}
  >
    <MediaThumbnail
      path={item.thumbPath}
      mtime={null}
      alt={`${dictionary.library.photoBadge}: ${item.fileName}`}
      width={PHOTO_ROW_THUMB_BOX}
      square
      kind="photo"
      selected={selected}
      loading={item.thumbPath === null && item.thumbState === 'pending'}
    />
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
        {item.fileName}
      </Typography>
      <Typography variant="caption" noWrap>
        {formatCapturedAt(item.capturedAt, dictionary.locale) ?? dictionary.photos.unknownDate}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {isProcessing ? (
          <PhotoStatusBadge
            status="analyzing"
            dictionary={dictionary}
            testId="photos-sidebar-badge-analyzing"
          />
        ) : null}
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
