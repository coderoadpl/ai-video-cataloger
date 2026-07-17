import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Snackbar } from '@mui/material';

import { AppHeader } from '../../components/ui/AppHeader.js';
import { AppLayout } from '../../components/ui/AppLayout.js';
import { NestedDbDialog } from '../../components/ui/dialogs/NestedDbDialog.js';
import { TerminalLog } from '../../components/ui/TerminalLog.js';
import type { LogLine } from '../../components/ui/use-terminal-log.js';
import { useMenuEvents } from './use-menu-events.js';
import { type ShellState } from './use-shell.js';

export type ShellModal = 'settings' | 'models' | 'prerequisites' | 'setup';

export interface TerminalPanelState {
  lines: readonly LogLine[];
  droppedCount: number;
  onCopy: () => void;
  onClear: () => void;
}

export interface ShellModalState {
  modal: ShellModal | null;
  close: () => void;
}

interface AppShellProps {
  shell: ShellState;
  sidebar: ReactNode;
  content: ReactNode;
  terminal?: TerminalPanelState;
  overlays?: ReactNode;
  renderModals?: (state: ShellModalState) => ReactNode;
  renderBanner?: (openModal: (modal: ShellModal) => void) => ReactNode;
  autoOpenSetup?: boolean;
  onAutoOpenSetupConsumed?: () => void;
}

export const AppShell = ({
  shell,
  sidebar,
  content,
  terminal,
  overlays,
  renderModals,
  renderBanner,
  autoOpenSetup = false,
  onAutoOpenSetupConsumed,
}: AppShellProps) => {
  const [modal, setModal] = useState<ShellModal | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);

  useMenuEvents({
    onShowSettings: () => setModal('settings'),
    onShowModelManager: () => setModal('models'),
    onShowPrerequisites: () => setModal('prerequisites'),
    onShowSetupWizard: () => setModal('setup'),
    onToggleTerminal: () => setTerminalCollapsed((value) => !value),
    onToggleSidebar: () => setSidebarCollapsed((value) => !value),
  });

  const autoOpenConsumed = useRef(false);
  const consumedCallback = useRef(onAutoOpenSetupConsumed);
  consumedCallback.current = onAutoOpenSetupConsumed;
  useEffect(() => {
    if (!autoOpenSetup || autoOpenConsumed.current) return;
    autoOpenConsumed.current = true;
    setModal('setup');
    consumedCallback.current?.();
  }, [autoOpenSetup]);

  return (
    <>
      <AppLayout
        header={
          <AppHeader
            appVersion={shell.appVersion}
            recentFolders={shell.recentFolders}
            isCheckingFolder={shell.isCheckingFolder}
            onOpenFolder={shell.openFolder}
            onSelectRecentFolder={shell.selectRecentFolder}
            onShowSettings={() => setModal('settings')}
            onShowModelManager={() => setModal('models')}
            onShowPrerequisites={() => setModal('prerequisites')}
          />
        }
        sidebar={sidebar}
        content={
          <>
            {renderBanner?.(setModal)}
            {content}
          </>
        }
        sidebarCollapsed={sidebarCollapsed}
        terminalCollapsed={terminalCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        onToggleTerminal={() => setTerminalCollapsed((value) => !value)}
        terminal={
          <TerminalLog
            lines={terminal?.lines ?? []}
            droppedCount={terminal?.droppedCount ?? 0}
            showJson={showJson}
          />
        }
        showJson={showJson}
        onShowJsonChange={setShowJson}
        {...(terminal === undefined ? {} : { onTerminalCopy: terminal.onCopy, onTerminalClear: terminal.onClear })}
      />
      <NestedDbDialog
        open={shell.nestedDb.open}
        paths={shell.nestedDb.paths}
        onClose={shell.closeNestedDb}
      />
      <Snackbar open={shell.folderError !== null} onClose={shell.closeFolderError}>
        <Alert severity="error" onClose={shell.closeFolderError}>{shell.folderError}</Alert>
      </Snackbar>
      {overlays}
      {renderModals?.({ modal, close: () => setModal(null) })}
    </>
  );
};
