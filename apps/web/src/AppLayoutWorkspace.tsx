import { useCallback, useState } from 'react';
import { Box } from '@mui/material';

import { AnalyzeScopeToggle } from './components/ui/AnalyzeScopeToggle.js';
import { ScopeAnalyzeToolbar } from './components/ui/ScopeAnalyzeToolbar.js';
import { LibrarySubnav } from './components/ui/LibrarySubnav.js';
import { CancelConfirmationDialog } from './components/ui/dialogs/CancelConfirmationDialog.js';
import { ProcessingOverlay } from './components/ui/ProcessingOverlay.js';
import { useTerminalLog } from './components/ui/use-terminal-log.js';
import { useCatalogWorkspace } from './features/catalog/use-catalog-workspace.js';
import { CatalogSidebar } from './features/catalog/CatalogSidebar.js';
import { useCatalogLock } from './features/catalog/use-catalog-lock.js';
import { useFolderWatch } from './features/catalog/use-folder-watch.js';
import { DetailsPanel } from './features/details/DetailsPanel.js';
import { LibraryView, type LibrarySeed } from './features/library/LibraryView.js';
import { PersonMediaPanel } from './features/library/PersonMediaPanel.js';
import { useCatalogIndex } from './features/library/use-catalog-index.js';
import { MapView } from './features/map/MapView.js';
import { useCatalogLocations, type CatalogLocation } from './features/map/use-catalog-locations.js';
import { ModelManagerModal } from './features/models/ModelManagerModal.js';
import { FacesIndexAction } from './features/people/FacesIndexAction.js';
import { PeopleView } from './features/people/PeopleView.js';
import { PhotosAnalysisSidebar } from './features/photos/PhotosAnalysisSidebar.js';
import { PhotosWorkspace } from './features/photos/PhotosWorkspace.js';
import { usePhotosWorkspace } from './features/photos/use-photos-workspace.js';
import { BrowsePreview, previewFromLocation, type PreviewMedia } from './features/preview/index.js';
import { PrerequisitesModal } from './features/prerequisites/PrerequisitesModal.js';
import { ReadinessNotice } from './features/readiness/ReadinessNotice.js';
import { useReadiness } from './features/readiness/use-readiness.js';
import { SetupWizard } from './features/wizard/SetupWizard.js';
import { useFirstLaunch } from './features/wizard/use-first-launch.js';
import { ProcessingDialogs } from './features/processing/ProcessingDialogs.js';
import { useProcessing } from './features/processing/use-processing.js';
import { useAnalysisNavigation } from './features/shell/use-analysis-navigation.js';
import { useModePreference } from './features/shell/use-mode-preference.js';
import { SettingsModal } from './features/settings/SettingsModal.js';
import { AppLayout } from './AppLayout.js';
import { useShell } from './features/shell/use-shell.js';
import { useAnalysisDisabledReason } from './features/readiness/use-disabled-reason.js';

export const AppLayoutWorkspace = () => {
  const catalogIndex = useCatalogIndex();
  const {
    mode,
    setMode,
    librarySurface,
    setLibrarySurface,
    analysisMedia,
    setAnalysisMedia,
  } = useModePreference(catalogIndex.hasFiles);
  const [librarySeed, setLibrarySeed] = useState<LibrarySeed | null>(null);
  const [mapFocus, setMapFocus] = useState<string | null>(null);
  const [modalRequest, setModalRequest] = useState<'settings' | null>(null);
  const [preview, setPreview] = useState<PreviewMedia | null>(null);
  const shell = useShell();

  const terminal = useTerminalLog();
  const photosAnalysisActive = mode === 'analysis' && analysisMedia === 'photos';
  const photosAnalysis = usePhotosWorkspace({
    active: photosAnalysisActive,
    addLine: terminal.addLine,
    folder: shell.currentFolder,
  });
  const workspace = useCatalogWorkspace(shell.currentFolder);
  const { catalog, tree, videoRegistry, selected, selectKey, followRenamedSelection, setScope,
    subfolderVideoCount, treeScopeAvailable, effectiveScope, showTree, treePendingCount, treeCanAnalyze } = workspace;
  useFolderWatch(shell.currentFolder, {
    photosActive: photosAnalysisActive,
    photosBusy: photosAnalysis.isBusy,
    scanPhotos: photosAnalysis.scanFolder,
  });
  const readiness = useReadiness(shell.currentFolder);
  const catalogLock = useCatalogLock();
  const firstLaunch = useFirstLaunch();
  const processing = useProcessing({
    videos: catalog.videos,
    addLine: terminal.addLine,
    checkReadiness: readiness.checkNow,
    onVideoRenamed: followRenamedSelection,
  });
  const disabledReason = useAnalysisDisabledReason(catalogLock.disabledReason, readiness);

  const selectedFingerprint = selected?.contentHash ?? null;
  const locations = useCatalogLocations({
    enabled: (mode === 'library' && librarySurface === 'map') || selectedFingerprint !== null,
  });
  const selectedLocation = selectedFingerprint === null ? null : locations.byFingerprint(selectedFingerprint);
  const analyzing = selected !== null && selected.path === processing.analyzingPath;
  const overlay = analyzing ? processing.progress : null;

  const driveRunning = processing.driveFileProgress !== null || processing.driveBatchWait !== null;
  const activeProgress = processing.batchProgress ?? processing.driveFileProgress;
  const scopedPendingCount = effectiveScope === 'tree' ? treePendingCount : processing.pendingCount;

  const { openInAnalysis, openPhotoInAnalysis } = useAnalysisNavigation({
    currentFolder: shell.currentFolder, selectRecentFolder: shell.selectRecentFolder, selectKey,
    photosSelectFingerprint: photosAnalysis.selectFingerprint,
    setMode, mode, setAnalysisMedia, folderAcceptedToken: shell.folderAcceptedToken,
  });
  const onOpenMapPreview = useCallback((location: CatalogLocation) => {
    const media = previewFromLocation(location);
    if (media !== null) setPreview(media);
  }, []);
  const videoSidebar = (
    <CatalogSidebar
      folder={shell.currentFolder}
      catalog={catalog}
      tree={tree}
      showTree={showTree}
      analyzingPath={processing.analyzingPath}
      lockBanner={catalogLock.lockBanner}
      registerVideos={videoRegistry.register}
      subfolderVideoCount={subfolderVideoCount}
      onSwitchToWholeTree={() => setScope('tree')}
      recentFolders={shell.recentFolders}
      isCheckingFolder={shell.isCheckingFolder}
      onOpenFolder={shell.openFolder}
      onSelectRecentFolder={shell.selectRecentFolder}
      onClearRecentFolders={shell.clearRecentFolders}
      onAnalysisMediaChange={setAnalysisMedia}
      scopeToggle={(
        <AnalyzeScopeToggle
          scope={effectiveScope}
          onScopeChange={setScope}
          disabled={!treeScopeAvailable || processing.isBusy}
          disabledReason={processing.isBusy ? 'busy' : 'no-video-subfolders'}
        />
      )}
      toolbar={
        <ScopeAnalyzeToolbar
          pendingCount={scopedPendingCount}
          erroredCount={effectiveScope === 'tree' ? 0 : processing.erroredCount}
          isBusy={processing.isBusy}
          progress={activeProgress}
          batchWait={processing.driveBatchWait}
          approximateCount={effectiveScope === 'tree'}
          canAnalyze={effectiveScope === 'tree' ? treeCanAnalyze : undefined}
          onAnalyze={() => {
            if (effectiveScope === 'tree') {
              if (shell.currentFolder !== null) processing.driveAnalyze(shell.currentFolder);
            } else {
              processing.batchAnalyze();
            }
          }}
          onStop={driveRunning ? processing.driveCancel : processing.requestBatchCancel}
          disabledReason={disabledReason}
        />
      }
    />
  );

  const photosSidebar = (
    <PhotosAnalysisSidebar
      state={photosAnalysis}
      onOpenFolder={shell.openFolder}
      recentFolders={shell.recentFolders}
      isCheckingFolder={shell.isCheckingFolder}
      onSelectRecentFolder={shell.selectRecentFolder}
      onClearRecentFolders={shell.clearRecentFolders}
      onAnalysisMediaChange={setAnalysisMedia}
      facesAction={(
          <FacesIndexAction
            active={photosAnalysisActive}
            folder={shell.currentFolder}
            addLine={terminal.addLine}
            lockReason={catalogLock.disabledReason}
            hasIndexableMedia={tree.processedTotal > 0 || (photosAnalysis.counts?.proxied ?? 0) > 0}
          />
      )}
    />
  );

  const detailContent = (
    <DetailsPanel
      video={selected}
      analyzing={analyzing}
      loading={shell.currentFolder !== null && selected === null && (catalog.isLoading || tree.isLoading)}
      folderOpen={shell.currentFolder !== null}
      hasVideos={shell.currentFolder !== null && catalog.videos.length > 0}
      onAnalyze={processing.analyze}
      onNavigateToCanonical={catalog.selectKey}
      disabledReason={disabledReason}
      onTagSearch={(tag) => {
        setLibrarySeed({ kind: 'tag', tag });
        setMode('library');
        setLibrarySurface('collection');
      }}
      location={selectedLocation === null ? null : {
        lat: selectedLocation.lat,
        lon: selectedLocation.lon,
        source: selectedLocation.source,
        accuracyM: selectedLocation.accuracyM,
        place: selectedLocation.place,
      }}
      onShowOnMap={selectedFingerprint === null ? undefined : () => {
        setMapFocus(selectedFingerprint);
        setMode('library');
        setLibrarySurface('map');
      }}
    />
  );

  const libraryContent = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <LibrarySubnav surface={librarySurface} onSelect={setLibrarySurface} />
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <LibraryView
          active={mode === 'library' && librarySurface === 'collection'}
          onOpenResult={openInAnalysis}
          onOpenPhotoInAnalysis={openPhotoInAnalysis}
          onGoToVideos={() => {
            setMode('analysis');
            setAnalysisMedia('videos');
          }}
          seed={librarySeed}
          onSeedConsumed={() => setLibrarySeed(null)}
        />
        <PeopleView
          active={mode === 'library' && librarySurface === 'people'}
          folder={shell.currentFolder}
          addLine={terminal.addLine}
          onOpenSettings={() => setModalRequest('settings')}
          onOpenInCollection={(personId, label, media) => {
            setLibrarySeed({ kind: 'person', personId, label, media });
            setMode('library');
            setLibrarySurface('collection');
          }}
          renderPersonMedia={(request) => (
            <PersonMediaPanel
              personId={request.personId}
              label={request.label}
              media={request.media}
              {...(request.fileCountLabel === undefined ? {} : { fileCountLabel: request.fileCountLabel })}
              {...(request.observationCountLabel === undefined ? {} : { observationCountLabel: request.observationCountLabel })}
              onClose={request.onClose}
              onOpenResult={openInAnalysis}
              onOpenPhotoInAnalysis={openPhotoInAnalysis}
            />
          )}
          lockReason={catalogLock.disabledReason}
        />
        <MapView
          active={mode === 'library' && librarySurface === 'map'}
          focusFingerprint={mapFocus}
          onOpenPhoto={() => {
            setLibrarySeed({ kind: 'media', media: 'photo' });
            setLibrarySurface('collection');
          }}
          onFocusConsumed={() => setMapFocus(null)}
          onOpenPreview={onOpenMapPreview}
        />
      </Box>
    </Box>
  );

  const analysisContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        data-testid="analysis-state"
        data-analyzing={processing.isBusy ? 'true' : 'false'}
        sx={{ display: 'none' }}
      />
      <Box sx={{ display: analysisMedia === 'videos' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {overlay === null ? null : (
          <ProcessingOverlay progress={overlay} onCancel={processing.requestCancel} />
        )}
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {detailContent}
        </Box>
      </Box>
      <Box sx={{ display: analysisMedia === 'photos' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <PhotosWorkspace
          active={mode === 'analysis' && analysisMedia === 'photos'}
          state={photosAnalysis}
          onSearchTag={(tag) => {
            setLibrarySeed({ kind: 'tag', tag });
            setMode('library');
            setLibrarySurface('collection');
          }}
        />
      </Box>
    </Box>
  );

  const overlays = (
    <>
      <ProcessingDialogs processing={processing} />
      <CancelConfirmationDialog
        confirmation={photosAnalysis.cancelConfirmation}
        media="photo"
        onClose={photosAnalysis.closeCancelConfirmation}
        onConfirm={photosAnalysis.confirmCancelAnalysis}
      />
      <BrowsePreview item={preview} onClose={() => setPreview(null)} onOpenInAnalysis={openInAnalysis} />
    </>
  );

  return (
    <AppLayout
      shell={shell}
      sidebar={mode === 'library' ? null : analysisMedia === 'photos' ? photosSidebar : videoSidebar}
      mode={mode}
      onModeChange={setMode}
      analysisMedia={analysisMedia}
      modalRequest={modalRequest}
      onModalRequestConsumed={() => setModalRequest(null)}
      content={mode === 'library' ? libraryContent : analysisContent}
      autoOpenSetup={firstLaunch.shouldAutoOpen}
      onAutoOpenSetupConsumed={firstLaunch.markSeen}
      terminal={{
        lines: terminal.lines,
        droppedCount: terminal.droppedCount,
        onCopy: (text) => {
          void navigator.clipboard.writeText(text);
        },
        onClear: () => {
          terminal.clear();
        },
      }}
      overlays={overlays}
      renderBanner={(openModal) => readiness.data === null ? null : (
        <ReadinessNotice
          readiness={readiness.data}
          onOpenSettings={() => openModal('settings')}
          onOpenSetup={() => openModal('setup')}
        />
      )}
      renderModals={({ modal, close, open }) => (
        <>
          <SettingsModal
            open={modal === 'settings'}
            folder={shell.currentFolder}
            onClose={close}
            onSaved={() => { void readiness.refresh(); }}
            onRunWizard={() => open('setup')}
          />
          <ModelManagerModal open={modal === 'models'} onClose={close} addLine={terminal.addLine} />
          <PrerequisitesModal
            open={modal === 'prerequisites'}
            folder={shell.currentFolder}
            onClose={close}
          />
          <SetupWizard
            open={modal === 'setup'}
            folder={shell.currentFolder}
            onClose={() => {
              firstLaunch.markSeen();
              close();
              void readiness.refresh();
            }}
          />
        </>
      )}
    />
  );
};
