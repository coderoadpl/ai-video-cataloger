import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';

import { ScopeAnalyzeToolbar, type AnalyzeScope } from '../components/ui/ScopeAnalyzeToolbar.js';
import { BatchSummaryDialog } from '../components/ui/dialogs/BatchSummaryDialog.js';
import { DriveSummaryDialog } from '../components/ui/dialogs/DriveSummaryDialog.js';
import { CancelConfirmationDialog } from '../components/ui/dialogs/CancelConfirmationDialog.js';
import { ProcessingOverlay } from '../components/ui/ProcessingOverlay.js';
import { useTerminalLog } from '../components/ui/use-terminal-log.js';
import { CatalogSidebar } from '../features/catalog/CatalogSidebar.js';
import { flattenTreeVideos, keyOf, type CatalogVideo } from '../features/catalog/index.web.js';
import { useCatalog } from '../features/catalog/use-catalog.js';
import { useScopePreference } from '../features/catalog/use-scope-preference.js';
import { useCatalogVideoRegistry } from '../features/catalog/use-catalog-video-registry.js';
import { useCatalogLock } from '../features/catalog/use-catalog-lock.js';
import { useCatalogTree } from '../features/catalog/use-catalog-tree.js';
import { DetailsPanel } from '../features/details/DetailsPanel.js';
import { ModelManagerModal } from '../features/models/ModelManagerModal.js';
import { PeopleView } from '../features/people/PeopleView.js';
import { PrerequisitesModal } from '../features/prerequisites/PrerequisitesModal.js';
import { ReadinessNotice } from '../features/readiness/ReadinessNotice.js';
import { useReadiness } from '../features/readiness/use-readiness.js';
import { SearchResults } from '../features/search/SearchResults.js';
import { useGlobalSearch } from '../features/search/use-global-search.js';
import { SetupWizard } from '../features/wizard/SetupWizard.js';
import { useFirstLaunch } from '../features/wizard/use-first-launch.js';
import { useProcessing } from '../features/processing/use-processing.js';
import { SettingsModal } from '../features/settings/SettingsModal.js';
import { AppShell } from '../features/shell/AppShell.js';
import { useShell } from '../features/shell/use-shell.js';
import { useAnalysisDisabledReason } from '../features/readiness/use-disabled-reason.js';
import { ViewNav, type MainView } from '../components/ui/ViewNav.js';

export const IndexRoute = () => {
  const [activeView, setActiveView] = useState<MainView>('videos');
  const [modalRequest, setModalRequest] = useState<'settings' | null>(null);
  const shell = useShell();
  const [scope, setScope] = useScopePreference(shell.currentFolder);
  const globalSearch = useGlobalSearch();
  const terminal = useTerminalLog();
  const catalog = useCatalog(shell.currentFolder);
  const videoRegistry = useCatalogVideoRegistry();
  const tree = useCatalogTree(shell.currentFolder);
  const readiness = useReadiness(shell.currentFolder);
  const catalogLock = useCatalogLock();
  const firstLaunch = useFirstLaunch();
  const processing = useProcessing({
    videos: catalog.videos,
    addLine: terminal.addLine,
    checkReadiness: readiness.checkNow,
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
  const analyzing = selected !== null && selected.path === processing.analyzingPath;
  const overlay = analyzing ? processing.progress : null;

  const driveRunning = processing.driveFileProgress !== null;
  const activeProgress = processing.batchProgress ?? processing.driveFileProgress;
  const hasSubfolderVideos = useMemo(() => {
    const root = tree.root;
    if (root === null) return false;
    return root.children.some((child) => (child.videoCount ?? child.videos.length) > 0);
  }, [tree.root]);
  const effectiveScope: AnalyzeScope = hasSubfolderVideos ? scope : 'folder';
  const showTree = effectiveScope === 'tree';
  const treePendingCount = Math.max(0, tree.videoTotal - tree.processedTotal);
  const scopedPendingCount = effectiveScope === 'tree' ? treePendingCount : processing.pendingCount;
  const treeCanAnalyze = tree.videoTotal > tree.processedTotal || tree.hasUnknownPending;

  const clearSearch = globalSearch.clearSearch;
  const [pendingSelection, setPendingSelection] = useState<{ folderPath: string; videoPath: string } | null>(null);
  const selectKey = catalog.selectKey;
  const currentFolder = shell.currentFolder;
  const selectRecentFolder = shell.selectRecentFolder;
  const openSearchResult = useCallback(
    (folderPath: string, videoPath: string) => {
      clearSearch();
      if (currentFolder === folderPath) {
        selectKey(videoPath);
        return;
      }
      setPendingSelection({ folderPath, videoPath });
      selectRecentFolder(folderPath);
    },
    [clearSearch, currentFolder, selectKey, selectRecentFolder],
  );
  useEffect(() => {
    if (pendingSelection === null || currentFolder !== pendingSelection.folderPath) return;
    selectKey(pendingSelection.videoPath);
    setPendingSelection(null);
  }, [pendingSelection, currentFolder, selectKey]);
  const sidebarCatalog = useMemo(
    () => ({
      ...catalog,
      select: (video: CatalogVideo) => {
        clearSearch();
        catalog.select(video);
      },
    }),
    [catalog, clearSearch],
  );

  const sidebar = (
    <CatalogSidebar
      folder={shell.currentFolder}
      catalog={sidebarCatalog}
      tree={tree}
      showTree={showTree}
      analyzingPath={processing.analyzingPath}
      lockBanner={catalogLock.lockBanner}
      registerVideos={videoRegistry.register}
      toolbar={
        <ScopeAnalyzeToolbar
          scope={effectiveScope}
          onScopeChange={setScope}
          pendingCount={scopedPendingCount}
          isBusy={processing.isBusy}
          progress={activeProgress}
          scopeToggleDisabled={!hasSubfolderVideos}
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

  const detailContent = activeView === 'people' ? null : globalSearch.active ? (
    <SearchResults search={globalSearch} onOpenFolder={shell.selectRecentFolder} onOpenResult={openSearchResult} />
  ) : (
    <DetailsPanel
      video={selected}
      analyzing={analyzing}
      loading={shell.currentFolder !== null && selected === null && (catalog.isLoading || tree.isLoading)}
      onAnalyze={processing.analyze}
      onNavigateToCanonical={catalog.selectKey}
      disabledReason={disabledReason}
      onTagSearch={globalSearch.submitSearch}
    />
  );

  const content = (
    <Box sx={{ display: activeView === 'videos' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
      <Box
        data-testid="analysis-state"
        data-analyzing={processing.isBusy ? 'true' : 'false'}
        sx={{ display: 'none' }}
      />
      {overlay === null ? null : (
        <ProcessingOverlay progress={overlay} onCancel={processing.requestCancel} />
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {detailContent}
      </Box>
    </Box>
  );

  const navigation = <ViewNav activeView={activeView} onSelectView={setActiveView} />;

  const overlays = (
    <>
      <CancelConfirmationDialog
        confirmation={processing.cancelConfirmation}
        onClose={processing.closeCancelDialog}
        onConfirm={processing.confirmCancel}
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
    </>
  );

  return (
    <AppShell
      shell={shell}
      sidebar={sidebar}
      navigation={navigation}
      modalRequest={modalRequest}
      onModalRequestConsumed={() => setModalRequest(null)}
      content={
        activeView === 'people' ? (
          <PeopleView
            active={activeView === 'people'}
            folder={shell.currentFolder}
            addLine={terminal.addLine}
            onOpenSettings={() => setModalRequest('settings')}
            lockReason={catalogLock.disabledReason}
          />
        ) : content
      }
      searchQuery={globalSearch.query}
      onSearchQueryChange={globalSearch.setQuery}
      onSearchSubmit={globalSearch.submitSearch}
      recentSearches={globalSearch.recentSearches}
      onRemoveRecentSearch={globalSearch.removeRecentSearch}
      topTags={globalSearch.topTags}
      onSearchFocus={globalSearch.onSearchFocus}
      autoOpenSetup={firstLaunch.shouldAutoOpen}
      onAutoOpenSetupConsumed={firstLaunch.markSeen}
      terminal={{
        lines: terminal.lines,
        droppedCount: terminal.droppedCount,
        onCopy: () => {
          void navigator.clipboard.writeText(terminal.copyText());
        },
        onClear: terminal.clear,
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
