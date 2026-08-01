import { type ReactNode } from 'react';
import { Box, Button, CircularProgress, List, ListItemButton, Typography, type SvgIconProps } from '@mui/material';

import { CheckCircleIcon, ContentCopyIcon, ErrorIcon, FolderIcon, ImageNotSupportedIcon, WarningIcon } from '../../components/ui/icons.js';
import { StatusBadge } from '../../components/ui/StatusBadge.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import type { Dictionary } from '../../i18n/dictionary.js';
import { folderName, formatCapturedAt } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media-url.js';
import type { StatusToken } from '../../theme.js';
import { photoBadges, sidebarSections, type PhotoBadge, type PhotoListItem } from './core/index.js';
import type { PhotosAnalysisState } from './use-photos-analysis.js';

const THUMB_BOX = 56;

interface PhotosSidebarProps {
  state: PhotosAnalysisState;
  onShowInLibrary: (root: string) => void;
  toolbar?: ReactNode;
}

const Centered = ({ children }: { children: ReactNode }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, py: 6, px: 2, textAlign: 'center' }}>
    {children}
  </Box>
);

const badgeLabel = (badge: PhotoBadge, dictionary: Dictionary): string => {
  switch (badge) {
    case 'analysed':
      return dictionary.videoStatus.completed;
    case 'duplicate':
      return dictionary.catalog.duplicateBadge;
    case 'proxyFailed':
      return dictionary.photosSidebar.badgeProxyFailed;
    case 'exifMissing':
      return dictionary.photosSidebar.badgeExifMissing;
    case 'missing':
      return dictionary.photosSidebar.badgeMissing;
  }
};

const TOKEN_FOR_BADGE: Record<PhotoBadge, StatusToken> = {
  analysed: 'completed',
  duplicate: 'notTracked',
  proxyFailed: 'pending',
  exifMissing: 'notTracked',
  missing: 'error',
};

const BadgeIcon = ({ badge, ...props }: { badge: PhotoBadge } & SvgIconProps) => {
  switch (badge) {
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
  }
};

const BadgeChip = ({ badge, dictionary }: { badge: PhotoBadge; dictionary: Dictionary }) => (
  <StatusBadge
    key={badge}
    icon={<BadgeIcon badge={badge} />}
    label={badgeLabel(badge, dictionary)}
    token={TOKEN_FOR_BADGE[badge]}
    testId={`photos-sidebar-badge-${badge}`}
  />
);

const PhotoSidebarRow = ({
  item,
  selected,
  onSelect,
  dictionary,
}: {
  item: PhotoListItem;
  selected: boolean;
  onSelect: () => void;
  dictionary: Dictionary;
}) => {
  const thumbPath = item.gridThumbPath ?? item.thumbPath;
  return (
    <ListItemButton
      selected={selected}
      onClick={onSelect}
      title={item.currentPath}
      data-testid="photos-sidebar-row"
      sx={{ alignItems: 'center', gap: 1.25, borderRadius: 1, py: 1 }}
    >
      <Box sx={{ width: THUMB_BOX, height: THUMB_BOX, flexShrink: 0, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
        {thumbPath === null ? null : (
          <Box component="img" loading="lazy" alt={item.fileName} src={mediaUrl(thumbPath, item.fingerprint)} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
          {item.fileName}
        </Typography>
        <Typography variant="caption" noWrap>
          {formatCapturedAt(item.capturedAt) ?? dictionary.photos.unknownDate}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {photoBadges(item).map((badge) => <BadgeChip key={badge} badge={badge} dictionary={dictionary} />)}
        </Box>
      </Box>
    </ListItemButton>
  );
};

export const PhotosSidebar = ({ state, onShowInLibrary, toolbar }: PhotosSidebarProps) => {
  const dictionary = useDictionary();

  if (state.roots.length === 0 && !state.isLoading) {
    return (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="photos-sidebar-empty">
        <Typography variant="body2" sx={{ fontWeight: 500 }}>{dictionary.photosSidebar.emptyTitle}</Typography>
        <Typography variant="caption" color="text.secondary">{dictionary.photosSidebar.emptyBody}</Typography>
        <Button
          variant="contained"
          size="small"
          onClick={state.scanFolder}
          data-testid="photos-sidebar-empty-scan"
        >
          {dictionary.photosSidebar.emptyScanCta}
        </Button>
      </Box>
    );
  }

  if (state.isLoading && state.roots.length === 0) {
    return (
      <Box data-testid="photos-sidebar-loading" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={22} />
      </Box>
    );
  }

  const sections = sidebarSections(state.items, state.roots, state.scope, state.selectedRoot);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {state.selectedRoot === null ? null : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <FolderIcon fontSize="small" sx={{ color: 'primary.main' }} />
            <Typography variant="h2" noWrap title={state.selectedRoot} sx={{ flex: 1, minWidth: 0 }}>
              {folderName(state.selectedRoot)}
            </Typography>
            <Button
              size="small"
              onClick={() => onShowInLibrary(state.selectedRoot ?? '')}
              data-testid="photos-folder-show-in-library"
            >
              {dictionary.photosSidebar.showInLibrary}
            </Button>
          </Box>
        )}
        {state.selectedRoot === null ? null : (
          <Typography variant="caption" noWrap title={state.selectedRoot}>
            {state.selectedRoot}
          </Typography>
        )}
        {toolbar === undefined ? null : <Box sx={{ mt: 1 }}>{toolbar}</Box>}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {sections.length === 0 ? (
          <Centered>
            <Typography variant="body2">{dictionary.photos.emptyNoPhotos}</Typography>
          </Centered>
        ) : (
          <List dense disablePadding sx={{ p: 1 }}>
            {sections.map((section) => (
              <Box key={section.root}>
                <ListItemButton
                  onClick={() => state.selectRoot(section.root)}
                  data-testid="photos-sidebar-section-header"
                  sx={{ borderRadius: 1 }}
                >
                  <Typography variant="caption" noWrap sx={{ fontWeight: 500 }}>
                    {folderName(section.root)}
                  </Typography>
                </ListItemButton>
                {section.items.map((item) => (
                  <PhotoSidebarRow
                    key={item.fingerprint}
                    item={item}
                    selected={item.fingerprint === state.selectedFingerprint}
                    onSelect={() => state.selectFingerprint(item.fingerprint)}
                    dictionary={dictionary}
                  />
                ))}
              </Box>
            ))}
          </List>
        )}
        {state.hasMore ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <Button size="small" onClick={state.loadMore} disabled={state.isLoadingMore} data-testid="photos-sidebar-load-more">
              {dictionary.photosSidebar.loadMore}
            </Button>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
};
