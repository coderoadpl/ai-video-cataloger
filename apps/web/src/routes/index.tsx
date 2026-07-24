import { useMemo, useState } from 'react';
import { Box, Button, ButtonGroup } from '@mui/material';

import { ScopeAnalyzeToolbar, type AnalyzeScope } from '../components/ui/ScopeAnalyzeToolbar.js';
import { BatchSummaryDialog } from '../components/ui/dialogs/BatchSummaryDialog.js';
import { CancelConfirmationDialog } from '../components/ui/dialogs/CancelConfirmationDialog.js';
import { ProcessingOverlay } from '../components/ui/ProcessingOverlay.js';
import { useTerminalLog } from '../components/ui/use-terminal-log.js';
import { CatalogSidebar } from '../features/catalog/CatalogSidebar.js';
import { flattenTreeVideos } from '../features/catalog/catalog-tree-model.js';
import { keyOf } from '../features/catalog/catalog-video.js';
import { useCatalog } from '../features/catalog/use-catalog.js';
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

export const IndexRoute = () => {
  const [activeView, setActiveView] = useState<'videos' | 'people'>('videos');
  const [modalRequest, setModalRequest] = useState<'settings' | null>(null);
  const [scope, setScope] = useState<AnalyzeScope>('folder');
  const shell = useShell();
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
  const disabledReason = catalogLock.disabledReason ?? (readiness.data !== null && !readiness.data.ready
    ? `Analysis unavailable: ${readiness.data.missingPieces.map((piece) => piece.name).join(', ')}`
    : readiness.isLoading ? 'Checking processing setup…' : undefined);

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
  const scopedPendingCount = scope === 'tree' ? tree.pendingTotal : processing.pendingCount;

  const sidebar = (
    <CatalogSidebar
      folder={shell.currentFolder}
      catalog={catalog}
      tree={tree}
      analyzingPath={processing.analyzingPath}
      skippedPaths={processing.skippedPaths}
      lockBanner={catalogLock.lockBanner}
      registerVideos={videoRegistry.register}
      toolbar={
        <ScopeAnalyzeToolbar
          scope={scope}
          onScopeChange={setScope}
          pendingCount={scopedPendingCount}
          isBusy={processing.isBusy}
          progress={activeProgress}
          onAnalyze={() => {
            if (scope === 'tree') {
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
    <SearchResults search={globalSearch} onOpenFolder={shell.selectRecentFolder} />
  ) : (
    <DetailsPanel
      video={selected}
      analyzing={analyzing}
      onAnalyze={processing.analyze}
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

  const navigation = (
    <ButtonGroup fullWidth size="small" variant="outlined" aria-label="Main view">
      <Button
        variant={activeView === 'videos' ? 'contained' : 'outlined'}
        onClick={() => setActiveView('videos')}
        data-testid="nav-videos"
      >
        Videos
      </Button>
      <Button
        variant={activeView === 'people' ? 'contained' : 'outlined'}
        onClick={() => setActiveView('people')}
        data-testid="nav-people"
      >
        People
      </Button>
    </ButtonGroup>
  );

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
      renderModals={({ modal, close }) => (
        <>
          <SettingsModal
            open={modal === 'settings'}
            folder={shell.currentFolder}
            onClose={close}
            onSaved={() => { void readiness.refresh(); }}
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
