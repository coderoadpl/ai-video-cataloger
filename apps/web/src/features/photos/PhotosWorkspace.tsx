import { useMemo, useState } from 'react';
import { Box, ButtonBase } from '@mui/material';

import { MediaDetailLayout } from '../../components/layout/MediaDetailLayout.js';
import { AnalysisEmptyState } from '../../components/ui/AnalysisEmptyState.js';
import { AnalysisWelcome } from '../../components/ui/AnalysisWelcome.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { mediaUrl } from '../../lib/media-url.js';
import { adjacentFingerprint, detailToListItem, flattenOrder, sidebarSections } from './core/index.js';
import { PhotoDetailPane } from './PhotoDetailPane.js';
import { PhotoViewer } from './PhotoViewer.js';
import type { PhotosAnalysisState } from './use-photos-analysis.js';

interface PhotosWorkspaceProps {
  active: boolean;
  state: PhotosAnalysisState;
  onSearchTag?: ((tag: string) => void) | undefined;
}

export const PhotosWorkspace = ({ active, state, onSearchTag }: PhotosWorkspaceProps) => {
  const dictionary = useDictionary();
  const [viewerOpen, setViewerOpen] = useState(false);

  const sections = useMemo(
    () => sidebarSections(state.items, state.scope, state.selectedRoot),
    [state.items, state.scope, state.selectedRoot],
  );
  const order = useMemo(() => flattenOrder(sections), [sections]);
  const selectedItem = useMemo(() => {
    const fromLoadedItems = state.items.find((item) => item.fingerprint === state.selectedFingerprint) ?? null;
    if (fromLoadedItems !== null) return fromLoadedItems;
    return state.detail !== null && state.detail.photo.fingerprint === state.selectedFingerprint
      ? detailToListItem(state.detail)
      : null;
  }, [state.items, state.selectedFingerprint, state.detail]);

  if (!active) return null;

  const proxySource = selectedItem === null ? null : (selectedItem.proxyPath ?? selectedItem.thumbPath);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {state.folder === null ? (
        <AnalysisWelcome />
      ) : selectedItem === null ? (
        <Box
          data-testid="photos-workspace-empty"
          sx={{ flex: 1 }}
        >
          <AnalysisEmptyState media="photo" empty={state.counts?.photos === 0} />
        </Box>
      ) : (
        <Box data-testid="photos-analysis-detail" sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <MediaDetailLayout
            layoutTestId="detail-layout"
            mainTestId="media-detail-main"
            mediaTestId="media-detail-media"
            belowTestId="media-detail-below"
            media={proxySource === null ? null : (
              <ButtonBase
                data-testid="photos-open-viewer"
                aria-label={dictionary.photos.openPreview}
                onClick={() => setViewerOpen(true)}
                sx={{
                  alignSelf: 'flex-start',
                  cursor: 'zoom-in',
                  borderRadius: 1,
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                }}
              >
                <Box
                  component="img"
                  alt={selectedItem.fileName}
                  src={mediaUrl(proxySource, selectedItem.fingerprint)}
                  sx={{ maxWidth: '100%', maxHeight: 420, objectFit: 'contain' }}
                />
              </ButtonBase>
            )}
            main={(
              <PhotoDetailPane
                detail={state.detail}
                isLoading={state.isDetailLoading}
                variants={state.variants}
                onSelectVariant={state.selectVariant}
                onAnalyze={state.analyzeSelectedPhoto}
                onSearchTag={onSearchTag}
                isBusy={state.isBusy}
                canAnalyze={state.canAnalyzeSelectedPhoto}
                analyzeProgress={state.analyzeProgress}
              />
            )}
            below={null}
          />
        </Box>
      )}
      {viewerOpen && selectedItem !== null ? (
        <PhotoViewer
          item={selectedItem}
          proxyPath={selectedItem.proxyPath}
          onClose={() => setViewerOpen(false)}
          onPrevious={
            adjacentFingerprint(order, selectedItem.fingerprint, -1) === null
              ? null
              : () => {
                const previous = adjacentFingerprint(order, selectedItem.fingerprint, -1);
                if (previous !== null) state.selectFingerprint(previous);
              }
          }
          onNext={
            adjacentFingerprint(order, selectedItem.fingerprint, 1) === null
              ? null
              : () => {
                const next = adjacentFingerprint(order, selectedItem.fingerprint, 1);
                if (next !== null) state.selectFingerprint(next);
              }
          }
        />
      ) : null}
    </Box>
  );
};
