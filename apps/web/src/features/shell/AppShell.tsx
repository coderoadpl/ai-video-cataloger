import { useState, type ReactNode } from 'react';

import { AppHeader } from '../../components/ui/AppHeader.js';
import { AppLayout } from '../../components/ui/AppLayout.js';
import { NestedDbDialog } from '../../components/ui/dialogs/NestedDbDialog.js';
import { TerminalLog } from '../../components/ui/TerminalLog.js';
import type { LogLine } from '../../components/ui/use-terminal-log.js';
import { useMenuEvents } from './use-menu-events.js';
import { type ShellState } from './use-shell.js';

export type ShellModal = 'settings' | 'models' | 'prerequisites';

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
}

/**
 * The application frame: header, folder bar, the sidebar and content slots, the
 * terminal panel and the global modal launchers. It owns the chrome-local UI
 * state — which modal is open, the sidebar/terminal collapse the menu toggles,
 * the terminal JSON toggle — and subscribes to the chrome menu events. Folder
 * and platform state arrive via `shell`; the catalog/details/processing islands
 * are injected as slots by the route; `overlays` carries the processing dialogs;
 * and the settings/models/prerequisites modals are supplied through `renderModals`
 * by the route so this feature never imports another feature.
 */
export const AppShell = ({ shell, sidebar, content, terminal, overlays, renderModals }: AppShellProps) => {
  const [modal, setModal] = useState<ShellModal | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);

  useMenuEvents({
    onShowSettings: () => setModal('settings'),
    onShowModelManager: () => setModal('models'),
    onShowPrerequisites: () => setModal('prerequisites'),
    onToggleTerminal: () => setTerminalCollapsed((value) => !value),
    onToggleSidebar: () => setSidebarCollapsed((value) => !value),
  });

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
        content={content}
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
      {overlays}
      {renderModals?.({ modal, close: () => setModal(null) })}
    </>
  );
};
