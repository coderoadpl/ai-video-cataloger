import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Snackbar, Typography } from '@mui/material';

import {
  AppShell,
  SIDEBAR_DEFAULT_SIZE,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
  TERMINAL_DEFAULT_SIZE,
} from './components/layout/AppShell.js';
import { AppHeader, type AppHeaderTag } from './components/ui/AppHeader.js';
import { NestedDbDialog } from './components/ui/dialogs/NestedDbDialog.js';
import { TerminalLog } from './components/ui/TerminalLog.js';
import type { LogLine } from './components/ui/use-terminal-log.js';
import { useMenuEvents } from './features/shell/use-menu-events.js';
import { type ShellState } from './features/shell/use-shell.js';
import { useDictionary } from './i18n/use-dictionary.js';

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
  open: (modal: ShellModal) => void;
}

const SIDEBAR_WIDTH_KEY = 'avc.sidebarWidth';

const clampWidth = (value: number): number =>
  Math.min(Math.max(value, SIDEBAR_MIN_SIZE), SIDEBAR_MAX_SIZE);

const readSidebarWidth = (): number => {
  if (typeof window === 'undefined' || typeof window.localStorage.getItem !== 'function') {
    return SIDEBAR_DEFAULT_SIZE;
  }
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (raw === null) return SIDEBAR_DEFAULT_SIZE;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clampWidth(parsed) : SIDEBAR_DEFAULT_SIZE;
};

const writeSidebarWidth = (value: number): void => {
  if (typeof window === 'undefined' || typeof window.localStorage.setItem !== 'function') return;
  window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(value)));
};

interface AppLayoutProps {
  shell: ShellState;
  sidebar: ReactNode;
  content: ReactNode;
  navigation?: ReactNode;
  terminal?: TerminalPanelState;
  overlays?: ReactNode;
  renderModals?: (state: ShellModalState) => ReactNode;
  renderBanner?: (openModal: (modal: ShellModal) => void) => ReactNode;
  modalRequest?: ShellModal | null;
  onModalRequestConsumed?: () => void;
  autoOpenSetup?: boolean;
  onAutoOpenSetupConsumed?: () => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onSearchSubmit?: (query: string) => void;
  recentSearches?: readonly string[];
  onRemoveRecentSearch?: (query: string) => void;
  topTags?: readonly AppHeaderTag[];
  onSearchFocus?: () => void;
}

export const AppLayout = ({
  shell,
  sidebar,
  content,
  navigation,
  terminal,
  overlays,
  renderModals,
  renderBanner,
  modalRequest = null,
  onModalRequestConsumed,
  autoOpenSetup = false,
  onAutoOpenSetupConsumed,
  searchQuery = '',
  onSearchQueryChange = () => undefined,
  onSearchSubmit = () => undefined,
  recentSearches = [],
  onRemoveRecentSearch = () => undefined,
  topTags = [],
  onSearchFocus = () => undefined,
}: AppLayoutProps) => {
  const dictionary = useDictionary();
  const [modal, setModal] = useState<ShellModal | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [terminalHeight, setTerminalHeight] = useState(TERMINAL_DEFAULT_SIZE);

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

  useEffect(() => {
    if (modalRequest === null) return;
    setModal(modalRequest);
    onModalRequestConsumed?.();
  }, [modalRequest, onModalRequestConsumed]);

  const onSidebarResize = useCallback((size: number) => {
    setSidebarWidth(size);
    writeSidebarWidth(size);
  }, []);

  const toggleSidebar = () => setSidebarCollapsed((value) => !value);

  return (
    <>
      <AppShell
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
            searchQuery={searchQuery}
            onSearchQueryChange={onSearchQueryChange}
            onSearchSubmit={onSearchSubmit}
            recentSearches={recentSearches}
            onRemoveRecentSearch={onRemoveRecentSearch}
            topTags={topTags}
            onSearchFocus={onSearchFocus}
          />
        }
        sidebarHeading={<Typography variant="h2">{dictionary.appFrame.sidebarHeading}</Typography>}
        sidebarAction={
          <Button size="small" color="inherit" onClick={toggleSidebar}>
            {dictionary.appFrame.hideSidebar}
          </Button>
        }
        sidebarExpandAction={
          <Button size="small" color="inherit" onClick={toggleSidebar}>
            {dictionary.appFrame.showSidebar}
          </Button>
        }
        navigation={navigation}
        sidebar={sidebar}
        sidebarCollapsed={sidebarCollapsed}
        sidebarWidth={sidebarWidth}
        onSidebarResize={onSidebarResize}
        banner={renderBanner?.(setModal)}
        content={content}
        terminalTitle={
          <Typography variant="caption" sx={{ color: 'grey.300' }}>
            {dictionary.appFrame.terminalTitle}
          </Typography>
        }
        terminalActions={
          <>
            {terminalCollapsed ? null : (
              <Button
                size="small"
                sx={{ color: showJson ? 'primary.light' : 'grey.400', minWidth: 0 }}
                onClick={() => setShowJson(!showJson)}
              >
                {dictionary.appFrame.terminalJson}
              </Button>
            )}
            {terminalCollapsed || terminal === undefined ? null : (
              <>
                <Button size="small" sx={{ color: 'grey.400', minWidth: 0 }} onClick={terminal.onCopy}>
                  {dictionary.appFrame.terminalCopy}
                </Button>
                <Button size="small" sx={{ color: 'grey.400', minWidth: 0 }} onClick={terminal.onClear}>
                  {dictionary.appFrame.terminalClear}
                </Button>
              </>
            )}
            <Button
              size="small"
              sx={{ color: 'grey.400', minWidth: 0 }}
              onClick={() => setTerminalCollapsed((value) => !value)}
            >
              {terminalCollapsed ? dictionary.appFrame.terminalExpand : dictionary.appFrame.terminalCollapse}
            </Button>
          </>
        }
        terminal={
          <TerminalLog
            lines={terminal?.lines ?? []}
            droppedCount={terminal?.droppedCount ?? 0}
            showJson={showJson}
          />
        }
        terminalCollapsed={terminalCollapsed}
        terminalHeight={terminalHeight}
        onTerminalResize={setTerminalHeight}
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
      {renderModals?.({ modal, close: () => setModal(null), open: setModal })}
    </>
  );
};
