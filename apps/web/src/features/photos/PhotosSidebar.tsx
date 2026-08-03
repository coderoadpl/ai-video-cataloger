import { type ReactNode } from 'react';
import { Alert, Box, Button, CircularProgress, LinearProgress, List, Typography } from '@mui/material';

import { type AnalysisMedia, AnalysisMediaToggle } from '../../components/ui/AnalysisMediaToggle.js';
import { SidebarFolderPanel } from '../../components/ui/SidebarFolderPanel.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import { folderName } from '../../lib/format.js';
import { sidebarSections } from './core/index.js';
import { PhotoRow } from './PhotoRow.js';
import { PhotosTree } from './PhotosTree.js';
import type { PhotosAnalysisState } from './use-photos-analysis.js';

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
      <Box sx={{ px: 1, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 0.5 }}>
        <Box sx={{ flex: '0 0 auto', minWidth: 0 }}>
          <AnalysisMediaToggle media="photos" onSelect={onAnalysisMediaChange} dense />
        </Box>
        {scopeToggle === undefined ? null : (
          <Box sx={{ flex: 1, minWidth: 0 }}>{scopeToggle}</Box>
        )}
      </Box>
    </>
  );

  const errorStrip = state.error === null ? null : (
    <Alert severity="error" sx={{ mx: 2, mt: 1 }} data-testid="photos-job-error">
      {formatAnalyzerError(state.error, dictionary.errors)}
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
    const autoScanFailed = state.error !== null && !state.isBusy;
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="photos-sidebar-unscanned">
        {header}
        {autoScanFailed ? null : (
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="photos-sidebar-scanning">
            <Typography variant="caption" color="text.secondary">{dictionary.photosSidebar.autoScanningBody}</Typography>
            {state.isBusy ? <LinearProgress data-testid="photos-sidebar-scan-progress" /> : null}
          </Box>
        )}
        {errorStrip}
        {autoScanFailed ? (
          <Box sx={{ p: 2 }}>
            <Button variant="contained" size="small" onClick={state.scanFolder} data-testid="photos-scan-action">
              {dictionary.photos.scanFolderAction}
            </Button>
          </Box>
        ) : null}
      </Box>
    );
  }

  const sections = state.scope === 'folder' ? sidebarSections(state.items, state.roots, state.scope, state.selectedRoot) : [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {header}
      {toolbar === undefined ? null : (
        <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>{toolbar}</Box>
      )}
      {errorStrip}
      <Box sx={{ flex: 1, minHeight: 0, overflow: state.scope === 'all' ? 'hidden' : 'auto' }}>
        {state.scope === 'all' ? (
          <PhotosTree
            selectedFingerprint={state.selectedFingerprint}
            processingFingerprints={state.processingFingerprints}
            onSelect={state.selectFingerprint}
          />
        ) : sections.length === 0 ? (
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
                  <PhotoRow
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
        {state.scope === 'folder' && state.hasMore ? (
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
