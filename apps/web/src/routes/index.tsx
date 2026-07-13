import { Box } from '@mui/material';

import { BatchToolbar } from '../components/ui/BatchToolbar.js';
import { BatchSummaryDialog } from '../components/ui/dialogs/BatchSummaryDialog.js';
import { CancelConfirmationDialog } from '../components/ui/dialogs/CancelConfirmationDialog.js';
import { ProcessingOverlay } from '../components/ui/ProcessingOverlay.js';
import { useTerminalLog } from '../components/ui/use-terminal-log.js';
import { CatalogSidebar } from '../features/catalog/CatalogSidebar.js';
import { useCatalog } from '../features/catalog/use-catalog.js';
import { DetailsPanel } from '../features/details/DetailsPanel.js';
import { ModelManagerModal } from '../features/models/ModelManagerModal.js';
import { PrerequisitesModal } from '../features/prerequisites/PrerequisitesModal.js';
import { useProcessing } from '../features/processing/use-processing.js';
import { SettingsModal } from '../features/settings/SettingsModal.js';
import { AppShell } from '../features/shell/AppShell.js';
import { useShell } from '../features/shell/use-shell.js';

/**
 * The page composition root: the one place the shell, catalog, details,
 * processing and terminal islands meet. It owns no server-state itself — the
 * hooks supply platform state, scan-driven video state and the processing state
 * machine — and threads the shared selection, the analyzing path, the batch
 * toolbar, the progress overlay and the processing dialogs between them. The
 * terminal buffer is created here and fed by the processing island (writer) and
 * rendered by the shell (reader).
 */
export const IndexRoute = () => {
  const shell = useShell();
  const terminal = useTerminalLog();
  const catalog = useCatalog(shell.currentFolder);
  const processing = useProcessing({ videos: catalog.videos, addLine: terminal.addLine });

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
        />
      }
    />
  );

  const content = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {overlay === null ? null : (
        <ProcessingOverlay progress={overlay} onCancel={processing.requestCancel} />
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <DetailsPanel video={selected} analyzing={analyzing} onAnalyze={processing.analyze} />
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
      content={content}
      terminal={{
        lines: terminal.lines,
        droppedCount: terminal.droppedCount,
        onCopy: () => {
          void navigator.clipboard.writeText(terminal.copyText());
        },
        onClear: terminal.clear,
      }}
      overlays={overlays}
      renderModals={({ modal, close }) => (
        <>
          <SettingsModal open={modal === 'settings'} folder={shell.currentFolder} onClose={close} />
          <ModelManagerModal open={modal === 'models'} onClose={close} addLine={terminal.addLine} />
          <PrerequisitesModal open={modal === 'prerequisites'} onClose={close} />
        </>
      )}
    />
  );
};
