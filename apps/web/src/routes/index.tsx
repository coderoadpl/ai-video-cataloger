import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';

import { folderName } from '../lib/format.js';
import { parentDir } from '../lib/media-url.js';
import { ScopeAnalyzeToolbar, type AnalyzeScope } from '../components/ui/ScopeAnalyzeToolbar.js';
import { LibrarySubnav } from '../components/ui/LibrarySubnav.js';
import { BatchSummaryDialog } from '../components/ui/dialogs/BatchSummaryDialog.js';
import { DriveSummaryDialog } from '../components/ui/dialogs/DriveSummaryDialog.js';
import { CancelConfirmationDialog } from '../components/ui/dialogs/CancelConfirmationDialog.js';
import { ProcessingOverlay } from '../components/ui/ProcessingOverlay.js';
import { useTerminalLog } from '../components/ui/use-terminal-log.js';
import { CatalogSidebar } from '../features/catalog/CatalogSidebar.js';
import { flattenTreeVideos, followRenamedKey, keyOf } from '../features/catalog/index.web.js';
import { useCatalog } from '../features/catalog/use-catalog.js';
import { useScopePreference } from '../features/catalog/use-scope-preference.js';
import { useCatalogVideoRegistry } from '../features/catalog/use-catalog-video-registry.js';
import { useCatalogLock } from '../features/catalog/use-catalog-lock.js';
import { useCatalogTree } from '../features/catalog/use-catalog-tree.js';
import { useFolderWatch } from '../features/catalog/use-folder-watch.js';
import { useTreeScopeAvailability } from '../features/catalog/use-tree-absent-files.js';
import { DetailsPanel } from '../features/details/DetailsPanel.js';
import { LibraryView, type LibraryItem, type LibrarySeed } from '../features/library/LibraryView.js';
import { deriveLibrarySeed } from '../features/library/show-in-library.js';
import { useCatalogIndex } from '../features/library/use-catalog-index.js';
import { MapView } from '../features/map/MapView.js';
import { useCatalogLocations, type CatalogLocation } from '../features/map/use-catalog-locations.js';
import { ModelManagerModal } from '../features/models/ModelManagerModal.js';
import { FacesIndexAction } from '../features/people/FacesIndexAction.js';
import { PeopleView } from '../features/people/PeopleView.js';
import { PhotosScopeToolbar } from '../features/photos/PhotosScopeToolbar.js';
import { PhotosSidebar } from '../features/photos/PhotosSidebar.js';
import { PhotosView } from '../features/photos/PhotosView.js';
import { PhotosWorkspace } from '../features/photos/PhotosWorkspace.js';
import { usePhotosAnalysis } from '../features/photos/use-photos-analysis.js';
import { BrowsePreview, previewFromLocation, previewFromSearchResult, type PreviewMedia } from '../features/preview/index.js';
import { PrerequisitesModal } from '../features/prerequisites/PrerequisitesModal.js';
import { ReadinessNotice } from '../features/readiness/ReadinessNotice.js';
import { useReadiness } from '../features/readiness/use-readiness.js';
import { SetupWizard } from '../features/wizard/SetupWizard.js';
import { useFirstLaunch } from '../features/wizard/use-first-launch.js';
import { useProcessing } from '../features/processing/use-processing.js';
import { useApiLog } from '../features/shell/use-api-log.js';
import { useModePreference } from '../features/shell/use-mode-preference.js';
import { SettingsModal } from '../features/settings/SettingsModal.js';
import { AppLayout } from '../AppLayout.js';
import { useShell } from '../features/shell/use-shell.js';
import { useAnalysisDisabledReason } from '../features/readiness/use-disabled-reason.js';

export const IndexRoute = () => {
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
  const [photoFocus, setPhotoFocus] = useState<string | null>(null);
  const [photosRootSeed, setPhotosRootSeed] = useState<string | null>(null);
  const [modalRequest, setModalRequest] = useState<'settings' | null>(null);
  const [preview, setPreview] = useState<PreviewMedia | null>(null);
  const shell = useShell();
  const [scope, setScope] = useScopePreference(shell.currentFolder);
  const terminal = useTerminalLog();
  const apiLog = useApiLog();
  const photosAnalysis = usePhotosAnalysis({
    active: mode === 'analysis' && analysisMedia === 'photos',
    addLine: terminal.addLine,
    folder: shell.currentFolder,
  });
  const catalog = useCatalog(shell.currentFolder);
  const videoRegistry = useCatalogVideoRegistry();
  const tree = useCatalogTree(shell.currentFolder);
  useFolderWatch(shell.currentFolder);
  const readiness = useReadiness(shell.currentFolder);
  const catalogLock = useCatalogLock();
  const firstLaunch = useFirstLaunch();
  const selectKey = catalog.selectKey;
  const selectedKeyRef = useRef(catalog.selectedKey);
  useEffect(() => {
    selectedKeyRef.current = catalog.selectedKey;
  }, [catalog.selectedKey]);
  const followRenamedSelection = useCallback(
    (oldPath: string, newPath: string) => {
      if (selectedKeyRef.current === oldPath) selectKey(newPath);
    },
    [selectKey],
  );
  const processing = useProcessing({
    videos: catalog.videos,
    addLine: terminal.addLine,
    checkReadiness: readiness.checkNow,
    onVideoRenamed: followRenamedSelection,
  });
  const disabledReason = useAnalysisDisabledReason(catalogLock.disabledReason, readiness);

  const selected = useMemo(() => {
    if (catalog.selectedVideo !== null) return catalog.selectedVideo;
    if (catalog.selectedKey === null) return null;
    const fromTree = tree.root === null
      ? null
      : flattenTreeVideos(tree.root).find((video) => keyOf(video) === catalog.selectedKey) ?? null;
    return fromTree ?? videoRegistry.lookup(catalog.selectedKey);
  }, [catalog.selectedVideo, catalog.selectedKey, tree.root, videoRegistry]);

  const selectedSnapshotRef = useRef<{ path: string; contentHash: string | null } | null>(null);
  useEffect(() => {
    if (selected !== null) selectedSnapshotRef.current = { path: selected.path, contentHash: selected.contentHash };
  }, [selected]);
  useEffect(() => {
    const currentKey = catalog.selectedKey;
    if (currentKey === null) return;
    const freshVideos = tree.root === null ? catalog.videos : [...catalog.videos, ...flattenTreeVideos(tree.root)];
    if (freshVideos.some((video) => video.path === currentKey)) return;
    const followed = followRenamedKey(selectedSnapshotRef.current, freshVideos);
    if (followed !== null && followed !== currentKey) selectKey(followed);
  }, [catalog.videos, tree.root, catalog.selectedKey, selectKey]);

  const selectedFingerprint = selected?.contentHash ?? null;
  const locations = useCatalogLocations({
    enabled: (mode === 'library' && librarySurface === 'map') || selectedFingerprint !== null,
  });
  const selectedLocation = selectedFingerprint === null ? null : locations.byFingerprint(selectedFingerprint);
  const analyzing = selected !== null && selected.path === processing.analyzingPath;
  const overlay = analyzing ? processing.progress : null;

  const driveRunning = processing.driveFileProgress !== null || processing.driveBatchWait !== null;
  const activeProgress = processing.batchProgress ?? processing.driveFileProgress;
  const subfolderVideoCount = useMemo(() => {
    const root = tree.root;
    if (root === null) return 0;
    return root.children.reduce((total, child) => total + (child.videoCount ?? child.videos.length), 0);
  }, [tree.root]);
  const treeScopeAvailable = useTreeScopeAvailability(shell.currentFolder, subfolderVideoCount);
  const effectiveScope: AnalyzeScope = treeScopeAvailable ? scope : 'folder';
  const showTree = effectiveScope === 'tree';
  const treePendingCount = Math.max(0, tree.videoTotal - tree.processedTotal);
  const scopedPendingCount = effectiveScope === 'tree' ? treePendingCount : processing.pendingCount;
  const treeCanAnalyze = tree.videoTotal > tree.processedTotal || tree.hasUnknownPending;

  const [pendingSelection, setPendingSelection] = useState<{ folderPath: string; videoPath: string } | null>(null);
  const currentFolder = shell.currentFolder;
  const selectRecentFolder = shell.selectRecentFolder;
  const openInAnalysis = useCallback(
    (folderPath: string, videoPath: string) => {
      setMode('analysis');
      setAnalysisMedia('videos');
      if (currentFolder === folderPath) {
        selectKey(videoPath);
        return;
      }
      setPendingSelection({ folderPath, videoPath });
      selectRecentFolder(folderPath);
    },
    [currentFolder, selectKey, selectRecentFolder, setAnalysisMedia, setMode],
  );
  useEffect(() => {
    if (pendingSelection === null || currentFolder !== pendingSelection.folderPath) return;
    selectKey(pendingSelection.videoPath);
    setPendingSelection(null);
  }, [pendingSelection, currentFolder, selectKey]);
  const photosSelectFingerprint = photosAnalysis.selectFingerprint;
  const openPhotoInAnalysis = useCallback(
    (root: string, fingerprint: string) => {
      setMode('analysis');
      setAnalysisMedia('photos');
      selectRecentFolder(root);
      photosSelectFingerprint(fingerprint);
    },
    [photosSelectFingerprint, selectRecentFolder, setAnalysisMedia, setMode],
  );
  const folderAcceptedToken = shell.folderAcceptedToken;
  const previousFolderAcceptedTokenRef = useRef(folderAcceptedToken);
  useEffect(() => {
    if (folderAcceptedToken === previousFolderAcceptedTokenRef.current) return;
    previousFolderAcceptedTokenRef.current = folderAcceptedToken;
    if (mode === 'library') setMode('analysis');
  }, [folderAcceptedToken, mode, setMode]);
  const onPreview = useCallback((item: LibraryItem) => setPreview(previewFromSearchResult(item)), []);
  const onOpenMapPreview = useCallback((location: CatalogLocation) => {
    const media = previewFromLocation(location);
    if (media !== null) setPreview(media);
  }, []);
  const onShowInLibrary = useCallback(
    (folderPath: string, fingerprint: string | null) => {
      setLibrarySeed(deriveLibrarySeed(folderPath, folderName(folderPath), fingerprint, catalogIndex.folders));
      setMode('library');
      setLibrarySurface('collection');
    },
    [catalogIndex.folders, setLibrarySurface, setMode],
  );
  const onShowPhotosRootInLibrary = useCallback(
    (root: string) => {
      setMode('library');
      setLibrarySurface('photos');
      setPhotosRootSeed(root);
    },
    [setLibrarySurface, setMode],
  );
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
      onShowInLibrary={onShowInLibrary}
      recentFolders={shell.recentFolders}
      isCheckingFolder={shell.isCheckingFolder}
      onOpenFolder={shell.openFolder}
      onSelectRecentFolder={shell.selectRecentFolder}
      onAnalysisMediaChange={setAnalysisMedia}
      toolbar={
        <ScopeAnalyzeToolbar
          scope={effectiveScope}
          onScopeChange={setScope}
          pendingCount={scopedPendingCount}
          isBusy={processing.isBusy}
          progress={activeProgress}
          batchWait={processing.driveBatchWait}
          scopeToggleDisabled={!treeScopeAvailable}
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
    <PhotosSidebar
      state={photosAnalysis}
      onShowInLibrary={onShowPhotosRootInLibrary}
      onOpenFolder={shell.openFolder}
      recentFolders={shell.recentFolders}
      isCheckingFolder={shell.isCheckingFolder}
      onSelectRecentFolder={shell.selectRecentFolder}
      onAnalysisMediaChange={setAnalysisMedia}
      toolbar={<PhotosScopeToolbar state={photosAnalysis} />}
    />
  );

  const detailContent = (
    <DetailsPanel
      video={selected}
      analyzing={analyzing}
      loading={shell.currentFolder !== null && selected === null && (catalog.isLoading || tree.isLoading)}
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
      onShowInLibrary={selected === null ? undefined : () => onShowInLibrary(parentDir(selected.path), selectedFingerprint)}
    />
  );

  const libraryContent = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <LibrarySubnav surface={librarySurface} onSelect={setLibrarySurface} />
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <LibraryView
          active={mode === 'library' && librarySurface === 'collection'}
          onOpenResult={openInAnalysis}
          onPreview={onPreview}
          onGoToVideos={() => {
            setMode('analysis');
            setAnalysisMedia('videos');
          }}
          seed={librarySeed}
          onSeedConsumed={() => setLibrarySeed(null)}
        />
        <PhotosView
          active={mode === 'library' && librarySurface === 'photos'}
          focusFingerprint={photoFocus}
          onFocusConsumed={() => setPhotoFocus(null)}
          rootSeed={photosRootSeed}
          onRootSeedConsumed={() => setPhotosRootSeed(null)}
          onOpenInAnalysis={openPhotoInAnalysis}
        />
        <PeopleView
          active={mode === 'library' && librarySurface === 'people'}
          folder={shell.currentFolder}
          addLine={terminal.addLine}
          onOpenSettings={() => setModalRequest('settings')}
          onSearchInLibrary={(personId, label) => {
            setLibrarySeed({ kind: 'person', personId, label });
            setMode('library');
            setLibrarySurface('collection');
          }}
          lockReason={catalogLock.disabledReason}
        />
        <MapView
          active={mode === 'library' && librarySurface === 'map'}
          focusFingerprint={mapFocus}
          onOpenPhoto={(fingerprint) => {
            setPhotoFocus(fingerprint);
            setLibrarySurface('photos');
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
          topStrip={(
            <FacesIndexAction
              active={mode === 'analysis' && analysisMedia === 'photos'}
              folder={shell.currentFolder}
              addLine={terminal.addLine}
              lockReason={catalogLock.disabledReason}
            />
          )}
        />
      </Box>
    </Box>
  );

  const overlays = (
    <>
      <CancelConfirmationDialog
        confirmation={processing.cancelConfirmation}
        onClose={processing.closeCancelDialog}
        onConfirm={processing.confirmCancel}
      />
      <CancelConfirmationDialog
        confirmation={photosAnalysis.cancelConfirmation}
        onClose={photosAnalysis.closeCancelConfirmation}
        onConfirm={photosAnalysis.confirmCancelAnalysis}
      />
      <BatchSummaryDialog
        open={processing.batchSummary.open}
        results={processing.batchSummary.results}
        onClose={processing.closeBatchSummary}
      />
      <DriveSummaryDialog
        open={processing.driveSummary.open}
        counts={processing.driveSummary.counts}
        onClose={processing.closeDriveSummary}
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
        apiLines: apiLog.lines,
        droppedCount: terminal.droppedCount,
        onCopy: (text) => {
          void navigator.clipboard.writeText(text);
        },
        onClear: () => {
          terminal.clear();
          apiLog.clear();
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
