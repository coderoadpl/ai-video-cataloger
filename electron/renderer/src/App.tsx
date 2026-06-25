/**
 * App - thin shell: hook composition + layout. State machines live in
 * hooks/, JSX in components/.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalLog } from '@/components/terminal-log';
import { AppLayout } from '@/components/layout';
import { AppHeader } from '@/components/app-header';
import { SidebarPanel } from '@/components/sidebar-panel';
import { MainPanel } from '@/components/main-panel';
import { NestedDbDialog } from '@/components/dialogs/nested-db-dialog';
import { CancelConfirmationDialog } from '@/components/dialogs/cancel-confirmation-dialog';
import { BatchSummaryDialog } from '@/components/dialogs/batch-summary-dialog';
import { SettingsModal } from '@/components/settings-modal';
import { ModelManagerModal } from '@/components/model-manager-modal';
import { PrerequisitesModal } from '@/components/prerequisites-modal';
import { VideoItem } from '@/components/video-list';
import { useCliCommand } from '@/hooks/use-cli-command';
import { useCatalog, keyOf } from '@/hooks/use-catalog';
import { useTerminalLog } from '@/hooks/use-terminal-log';
import { useTerminalPrefs } from '@/hooks/use-terminal-prefs';
import { useFolder } from '@/hooks/use-folder';
import { useVideoLoader } from '@/hooks/use-video-loader';
import { useBatchProcessor } from '@/hooks/use-batch-processor';
import { useMenuEvents } from '@/hooks/use-menu-events';

function App(): JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showModelManager, setShowModelManager] = useState(false);
  const [showPrerequisites, setShowPrerequisites] = useState(false);

  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion).catch(console.error);
  }, []);

  // Terminal log (bounded ring buffer) and persisted terminal UI preferences
  const { lines, droppedCount, addLine, clear, copyToClipboard } = useTerminalLog();
  const prefs = useTerminalPrefs();

  // CLI access; folder selection drives the catalog (videos + selection)
  const runCli = useCliCommand();
  const loadVideosRef = useRef<(folderPath: string) => Promise<void>>(async () => {});
  const handleFolderOpened = useCallback((folderPath: string) => loadVideosRef.current(folderPath), []);
  const folder = useFolder({ runCli, addLogLine: addLine, onFolderOpened: handleFolderOpened });
  const { videos, selectedVideo, selectKey, refresh, isLoading: isLoadingVideos } =
    useCatalog(folder.currentFolder, runCli, addLine);
  const { isGeneratingThumbnails, loadVideosForFolder } = useVideoLoader({
    runCli, addLogLine: addLine, refresh,
    currentFolder: folder.currentFolder, videosCount: videos.length, isLoadingVideos,
  });
  useEffect(() => {
    loadVideosRef.current = loadVideosForFolder;
  }, [loadVideosForFolder]);

  // Single-video analysis and the batch queue state machine
  const processor = useBatchProcessor({
    runCli, addLogLine: addLine, currentFolder: folder.currentFolder, videos, refresh,
  });

  // Select by stable key, so the item is always the up-to-date scan entry
  const handleSelectVideo = useCallback((video: VideoItem) => {
    selectKey(keyOf(video));
  }, [selectKey]);

  // Memoized log message handler for modals
  const handleModalLogMessage = useCallback((message: string, type?: 'info' | 'success' | 'error') => {
    const prefix = type === 'success' ? '\x1b[32m✓\x1b[0m ' : type === 'error' ? '\x1b[31m✗\x1b[0m ' : '\x1b[36m';
    addLine(`${prefix}${message}${type === 'info' ? '\x1b[0m' : ''}`,
      type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');
  }, [addLine]);

  // Menu action: clear recent folders and the whole catalog
  const handleClearRecentFolders = useCallback(async () => {
    await window.electronAPI?.folder.clearRecent();
    folder.clearFolders();
    // Clearing the folder clears the catalog (videos + selection)
    await refresh({ folder: null });
    addLine('\x1b[32m✓\x1b[0m Recent folders cleared', 'success');
  }, [folder, refresh, addLine]);

  // Listen for menu events from main process
  useMenuEvents({
    onOpenFolder: folder.openFolder,
    onOpenRecentFolder: folder.selectRecentFolder,
    onClearRecentFolders: handleClearRecentFolders,
    onToggleTerminal: prefs.toggleTerminalCollapsed,
    onToggleSidebar: () => setSidebarCollapsed((prev) => !prev),
    onShowSettings: () => setShowSettings(true),
    onShowPrerequisites: () => setShowPrerequisites(true),
    onShowModelManager: () => setShowModelManager(true),
  });

  return (
    <>
      <AppLayout
        sidebar={
          <SidebarPanel
            currentFolder={folder.currentFolder}
            isGeneratingThumbnails={isGeneratingThumbnails}
            pendingVideosCount={processor.pendingVideosCount}
            isBatchProcessing={processor.isBatchProcessing}
            isAnalyzing={processor.isAnalyzing}
            batchProgress={processor.batchProgress}
            onBatchAnalyze={processor.batchAnalyze}
            onBatchCancel={processor.requestBatchCancel}
            videos={videos}
            selectedVideoPath={selectedVideo?.path || null}
            onSelectVideo={handleSelectVideo}
            isLoadingVideos={isLoadingVideos}
            analyzingVideoPath={processor.analyzingVideoPath}
          />
        }
        content={
          <div className="flex flex-col h-full">
            <AppHeader
              appVersion={appVersion}
              recentFolders={folder.recentFolders}
              isCheckingFolder={folder.isCheckingFolder}
              onOpenFolder={folder.openFolder}
              onSelectRecentFolder={folder.selectRecentFolder}
              onShowSettings={() => setShowSettings(true)}
              onShowModelManager={() => setShowModelManager(true)}
              onShowPrerequisites={() => setShowPrerequisites(true)}
            />
            <MainPanel
              selectedVideo={selectedVideo}
              currentFolder={folder.currentFolder}
              isAnalyzing={processor.isAnalyzing}
              analyzingVideoPath={processor.analyzingVideoPath}
              processingProgress={processor.processingProgress}
              onAnalyze={processor.analyzeVideo}
              onCancelClick={processor.requestCancel}
            />
          </div>
        }
        terminal={
          <TerminalLog
            lines={lines}
            droppedCount={droppedCount}
            showJson={prefs.showJson}
            onClear={clear}
            className="h-full"
            showHeader={false}
          />
        }
        terminalCollapsed={prefs.terminalCollapsed}
        onTerminalCollapsedChange={prefs.setTerminalCollapsed}
        terminalSize={prefs.terminalSize}
        onTerminalSizeChange={prefs.setTerminalSize}
        sidebarCollapsed={sidebarCollapsed}
        onSidebarCollapsedChange={setSidebarCollapsed}
        onTerminalClear={clear}
        onTerminalCopy={copyToClipboard}
        showJson={prefs.showJson}
        onShowJsonChange={prefs.setShowJson}
      />

      <NestedDbDialog
        open={folder.nestedDbError.open}
        paths={folder.nestedDbError.paths}
        onClose={folder.closeNestedDbError}
      />
      <CancelConfirmationDialog
        confirmation={processor.cancelConfirmation}
        onClose={processor.closeCancelModal}
        onConfirmSingle={processor.confirmCancel}
        onConfirmBatch={processor.confirmBatchCancel}
      />
      <BatchSummaryDialog
        open={processor.showBatchSummary}
        results={processor.batchResults}
        onClose={processor.closeBatchSummary}
      />
      <SettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
        currentFolder={folder.currentFolder}
        onConfigSaved={() => addLine('\x1b[32m✓\x1b[0m Settings saved', 'success')}
      />
      <ModelManagerModal
        open={showModelManager}
        onOpenChange={setShowModelManager}
        onLogMessage={handleModalLogMessage}
      />
      <PrerequisitesModal
        open={showPrerequisites}
        onOpenChange={setShowPrerequisites}
        onLogMessage={handleModalLogMessage}
      />
    </>
  );
}

export default App;
