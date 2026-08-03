import { type ReactNode } from 'react';
import { alpha, Alert, Box, Button, CircularProgress, List, ListItemButton, Tooltip, Typography, type SvgIconProps } from '@mui/material';

import { type AnalysisMedia, AnalysisMediaToggle } from '../../components/ui/AnalysisMediaToggle.js';
import { CheckCircleIcon, ContentCopyIcon, ErrorIcon, ImageNotSupportedIcon, WarningIcon } from '../../components/ui/icons.js';
import { SidebarFolderPanel } from '../../components/ui/SidebarFolderPanel.js';
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
  onOpenFolder: () => void;
  toolbar?: ReactNode;
  scopeToggle?: ReactNode;
  recentFolders?: string[];
  isCheckingFolder?: boolean;
  onSelectRecentFolder?: (folderPath: string) => void;
  onClearRecentFolders?: (() => void) | undefined;
  onAnalysisMediaChange?: (media: AnalysisMedia) => void;
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
      <Box sx={{ position: 'relative', width: THUMB_BOX, height: THUMB_BOX, flexShrink: 0, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
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
          {formatCapturedAt(item.capturedAt) ?? dictionary.photos.unknownDate}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {photoBadges(item).map((badge) => <BadgeChip key={badge} badge={badge} dictionary={dictionary} />)}
        </Box>
      </Box>
    </ListItemButton>
  );
};

export const PhotosSidebar = ({
  state,
  onOpenFolder,
  toolbar,
  scopeToggle,
  recentFolders = [],
  isCheckingFolder = false,
  onSelectRecentFolder = () => undefined,
  onClearRecentFolders,
  onAnalysisMediaChange = () => undefined,
}: PhotosSidebarProps) => {
  const dictionary = useDictionary();

  const folderPanel = state.scope === 'folder' && state.folderState !== 'scanned' ? state.folderState : null;
  const currentFolder = state.folder;

  const header = (
    <>
      <SidebarFolderPanel
        folder={currentFolder}
        recentFolders={recentFolders}
        isCheckingFolder={isCheckingFolder}
        onOpenFolder={onOpenFolder}
        onSelectRecentFolder={onSelectRecentFolder}
        onClearRecentFolders={onClearRecentFolders}
        emptyHint={(
          <>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{dictionary.photosSidebar.noFolderTitle}</Typography>
            <Typography variant="caption" color="text.secondary">{dictionary.photosSidebar.noFolderBody}</Typography>
          </>
        )}
      />
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <AnalysisMediaToggle media="photos" onSelect={onAnalysisMediaChange} fullWidth />
        </Box>
        {scopeToggle === undefined ? null : (
          <Box sx={{ flex: 1, minWidth: 0 }}>{scopeToggle}</Box>
        )}
      </Box>
    </>
  );

  const errorStrip = state.error === null ? null : (
    <Alert severity="error" sx={{ mx: 2, mt: 1 }} data-testid="photos-job-error">
      {state.error}
    </Alert>
  );

  if (state.isLoading && folderPanel !== 'no-folder') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {header}
        <Box data-testid="photos-sidebar-loading" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={22} />
        </Box>
      </Box>
    );
  }

  if (folderPanel === 'no-folder') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="photos-sidebar-no-folder">
        {header}
      </Box>
    );
  }

  if (folderPanel === 'unscanned') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="photos-sidebar-unscanned">
        {header}
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="caption" color="text.secondary">{dictionary.photosSidebar.unscannedBody}</Typography>
          <Button
            variant="contained"
            size="small"
            onClick={state.scanFolder}
            data-testid="photos-scan-action"
          >
            {dictionary.photosSidebar.scanThisFolderCta}
          </Button>
        </Box>
        {errorStrip}
      </Box>
    );
  }

  const sections = sidebarSections(state.items, state.roots, state.scope, state.selectedRoot);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {header}
      {toolbar === undefined ? null : (
        <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>{toolbar}</Box>
      )}
      {errorStrip}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {sections.length === 0 ? (
          <Centered>
            <Typography variant="body2">{dictionary.photos.emptyNoPhotos}</Typography>
          </Centered>
        ) : (
          <List dense disablePadding sx={{ p: 1 }}>
            {sections.map((section) => (
              <Box key={section.root}>
                <Box data-testid="photos-sidebar-section-header" sx={{ px: 2, py: 0.75 }}>
                  <Typography variant="caption" noWrap sx={{ fontWeight: 500 }}>
                    {folderName(section.root)}
                  </Typography>
                </Box>
                {section.items.map((item) => (
                  <PhotoSidebarRow
                    key={item.fingerprint}
                    item={item}
                    selected={item.fingerprint === state.selectedFingerprint}
                    isProcessing={state.processingFingerprints.has(item.fingerprint)}
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
