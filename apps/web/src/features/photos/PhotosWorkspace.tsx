import { useMemo, useState, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { mediaUrl } from '../../lib/media-url.js';
import { adjacentFingerprint, flattenOrder, sidebarSections } from './core/index.js';
import { PhotoDetailPane } from './PhotoDetailPane.js';
import { PhotoViewer } from './PhotoViewer.js';
import type { PhotosAnalysisState } from './use-photos-analysis.js';

interface PhotosWorkspaceProps {
  active: boolean;
  state: PhotosAnalysisState;
  topStrip?: ReactNode;
}

export const PhotosWorkspace = ({ active, state, topStrip }: PhotosWorkspaceProps) => {
  const dictionary = useDictionary();
  const [viewerOpen, setViewerOpen] = useState(false);

  const sections = useMemo(
    () => sidebarSections(state.items, state.roots, state.scope, state.selectedRoot),
    [state.items, state.roots, state.scope, state.selectedRoot],
  );
  const order = useMemo(() => flattenOrder(sections), [sections]);
  const selectedItem = state.items.find((item) => item.fingerprint === state.selectedFingerprint) ?? null;

  if (!active) return null;

  const proxySource = selectedItem === null ? null : (selectedItem.proxyPath ?? selectedItem.thumbPath);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {topStrip === undefined ? null : <Box sx={{ px: 2, pt: 1 }}>{topStrip}</Box>}
      {selectedItem === null ? (
        <Box
          data-testid="photos-workspace-empty"
          sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}
        >
          <Typography variant="body2" color="text.secondary">{dictionary.photosWorkspace.emptyTitle}</Typography>
        </Box>
      ) : (
        <Box data-testid="photos-analysis-detail" sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {proxySource === null ? null : (
            <Box
              component="img"
              alt={selectedItem.fileName}
              src={mediaUrl(proxySource, selectedItem.fingerprint)}
              onClick={() => setViewerOpen(true)}
              sx={{ maxWidth: '100%', maxHeight: 420, objectFit: 'contain', cursor: 'zoom-in', alignSelf: 'flex-start' }}
            />
          )}
          <PhotoDetailPane
            showAnalysisTools
            detail={state.detail}
            isLoading={state.isDetailLoading}
            variants={state.variants}
            onSelectVariant={state.selectVariant}
            onAnalyze={state.analyzePhotos}
            isBusy={state.isBusy}
            canAnalyze={state.canAnalyze}
            analyzeProgress={state.analyzeProgress}
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
