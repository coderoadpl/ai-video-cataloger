import { useState } from 'react';
import { Box, Button, ButtonGroup } from '@mui/material';

import { BatchToolbar } from '../components/ui/BatchToolbar.js';
import { BatchSummaryDialog } from '../components/ui/dialogs/BatchSummaryDialog.js';
import { CancelConfirmationDialog } from '../components/ui/dialogs/CancelConfirmationDialog.js';
import { ProcessingOverlay } from '../components/ui/ProcessingOverlay.js';
import { useTerminalLog } from '../components/ui/use-terminal-log.js';
import { CatalogSidebar } from '../features/catalog/CatalogSidebar.js';
import { useCatalog } from '../features/catalog/use-catalog.js';
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
  const shell = useShell();
  const globalSearch = useGlobalSearch();
  const terminal = useTerminalLog();
  const catalog = useCatalog(shell.currentFolder);
  const readiness = useReadiness(shell.currentFolder);
  const firstLaunch = useFirstLaunch();
  const processing = useProcessing({
    videos: catalog.videos,
    addLine: terminal.addLine,
    checkReadiness: readiness.checkNow,
  });
  const disabledReason = readiness.data !== null && !readiness.data.ready
    ? `Analysis unavailable: ${readiness.data.missingPieces.map((piece) => piece.name).join(', ')}`
    : readiness.isLoading ? 'Checking processing setup…' : undefined;

  const selected = catalog.selectedVideo;
  const analyzing = selected !== null && selected.path === processing.analyzingPath;
  const overlay = analyzing ? processing.progress : null;

  const sidebar = (
    <CatalogSidebar
      folder={shell.currentFolder}
      catalog={catalog}
      analyzingPath={processing.analyzingPath}
      toolbar={
        <BatchToolbar
          pendingCount={processing.pendingCount}
          isBusy={processing.isBusy}
          batchProgress={processing.batchProgress}
          onAnalyzeAll={processing.batchAnalyze}
          onStop={processing.requestBatchCancel}
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
          />
        ) : content
      }
      searchQuery={globalSearch.query}
      onSearchQueryChange={globalSearch.setQuery}
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
