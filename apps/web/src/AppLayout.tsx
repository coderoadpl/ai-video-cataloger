import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Snackbar, Typography, type SnackbarCloseReason } from '@mui/material';

import {
  AppShell,
  SIDEBAR_DEFAULT_SIZE,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
  TERMINAL_DEFAULT_SIZE,
} from './components/layout/AppShell.js';
import { AppHeader } from './components/ui/AppHeader.js';
import { type AnalysisMedia } from './components/ui/AnalysisMediaToggle.js';
import { type AppMode } from './components/ui/ModeSwitcher.js';
import { NestedDbDialog } from './components/ui/dialogs/NestedDbDialog.js';
import { TerminalLog } from './components/ui/TerminalLog.js';
import { mergeLogLines, renderLine, type LogLine, type TerminalViewMode } from './components/ui/use-terminal-log.js';
import { BackupIndicator } from './features/settings/BackupIndicator.js';
import { useMenuEvents } from './features/shell/use-menu-events.js';
import { type ShellState } from './features/shell/use-shell.js';
import { useDictionary } from './i18n/use-dictionary.js';

export type ShellModal = 'settings' | 'models' | 'prerequisites' | 'setup';

export interface TerminalPanelState {
  lines: readonly LogLine[];
  apiLines?: readonly LogLine[];
  droppedCount: number;
  onCopy: (text: string) => void;
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

const TERMINAL_RAW_MODE_KEY = 'avc.terminalRawMode';

const readTerminalRawMode = (): TerminalViewMode => {
  if (typeof window === 'undefined' || typeof window.localStorage.getItem !== 'function') return 'friendly';
  return window.localStorage.getItem(TERMINAL_RAW_MODE_KEY) === '1' ? 'raw' : 'friendly';
};

const writeTerminalRawMode = (mode: TerminalViewMode): void => {
  if (typeof window === 'undefined' || typeof window.localStorage.setItem !== 'function') return;
  window.localStorage.setItem(TERMINAL_RAW_MODE_KEY, mode === 'raw' ? '1' : '0');
};

interface AppLayoutProps {
  shell: ShellState;
  sidebar: ReactNode | null;
  content: ReactNode;
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  analysisMedia: AnalysisMedia;
  terminal?: TerminalPanelState;
  overlays?: ReactNode;
  renderModals?: (state: ShellModalState) => ReactNode;
  renderBanner?: (openModal: (modal: ShellModal) => void) => ReactNode;
  modalRequest?: ShellModal | null;
  onModalRequestConsumed?: () => void;
  autoOpenSetup?: boolean;
  onAutoOpenSetupConsumed?: () => void;
}

export const AppLayout = ({
  shell,
  sidebar,
  content,
  mode,
  onModeChange,
  analysisMedia,
  terminal,
  overlays,
  renderModals,
  renderBanner,
  modalRequest = null,
  onModalRequestConsumed,
  autoOpenSetup = false,
  onAutoOpenSetupConsumed,
}: AppLayoutProps) => {
  const dictionary = useDictionary();
  const [modal, setModal] = useState<ShellModal | null>(null);
  const [rawMode, setRawMode] = useState<TerminalViewMode>(readTerminalRawMode);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [terminalHeight, setTerminalHeight] = useState(TERMINAL_DEFAULT_SIZE);

  const toggleTerminal = useCallback(() => {
    setTerminalCollapsed((value) => !value);
  }, []);

  const toggleRawMode = useCallback(() => {
    setRawMode((value) => {
      const next: TerminalViewMode = value === 'raw' ? 'friendly' : 'raw';
      writeTerminalRawMode(next);
      return next;
    });
  }, []);

  const terminalLines = useMemo(() => terminal?.lines ?? [], [terminal?.lines]);
  const terminalApiLines = useMemo(() => terminal?.apiLines ?? [], [terminal?.apiLines]);
  const visibleText = useMemo(
    () =>
      (rawMode === 'raw' ? mergeLogLines(terminalLines, terminalApiLines) : terminalLines)
        .map((line) => renderLine(line, rawMode))
        .join('\n'),
    [terminalLines, terminalApiLines, rawMode],
  );

  useMenuEvents({
    onShowSettings: () => setModal('settings'),
    onShowModelManager: () => setModal('models'),
    onShowPrerequisites: () => setModal('prerequisites'),
    onShowSetupWizard: () => setModal('setup'),
    onToggleTerminal: toggleTerminal,
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
            onShowSettings={() => setModal('settings')}
            onShowModelManager={() => setModal('models')}
            onShowPrerequisites={() => setModal('prerequisites')}
            mode={mode}
            onModeChange={onModeChange}
          />
        }
        sidebarHeading={
          <Typography variant="h2">
            {mode === 'analysis' && analysisMedia === 'photos'
              ? dictionary.appFrame.sidebarHeadingPhotos
              : dictionary.appFrame.sidebarHeading}
          </Typography>
        }
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
            <BackupIndicator onOpenSettings={() => setModal('settings')} />
            {terminalCollapsed ? null : (
              <Button
                size="small"
                sx={{ color: rawMode === 'raw' ? 'primary.light' : 'grey.400', minWidth: 0 }}
                onClick={toggleRawMode}
              >
                {dictionary.appFrame.terminalRaw}
              </Button>
            )}
            {terminalCollapsed || terminal === undefined ? null : (
              <>
                <Button
                  size="small"
                  sx={{ color: 'grey.400', minWidth: 0 }}
                  onClick={() => terminal.onCopy(visibleText)}
                >
                  {dictionary.appFrame.terminalCopy}
                </Button>
                <Button size="small" sx={{ color: 'grey.400', minWidth: 0 }} onClick={terminal.onClear}>
                  {dictionary.appFrame.terminalClear}
                </Button>
              </>
            )}
            <Button size="small" sx={{ color: 'grey.400', minWidth: 0 }} onClick={toggleTerminal}>
              {terminalCollapsed ? dictionary.appFrame.terminalExpand : dictionary.appFrame.terminalCollapse}
            </Button>
          </>
        }
        terminal={
          <TerminalLog
            lines={terminalLines}
            apiLines={terminalApiLines}
            droppedCount={terminal?.droppedCount ?? 0}
            mode={rawMode}
          />
        }
        terminalCollapsed={terminalCollapsed}
        terminalHeight={terminalHeight}
        onTerminalResize={setTerminalHeight}
        terminalHidden={mode === 'library'}
      />
      <NestedDbDialog
        open={shell.nestedDb.open}
        paths={shell.nestedDb.paths}
        onClose={shell.closeNestedDb}
      />
      <Snackbar
        open={shell.folderError !== null}
        autoHideDuration={8000}
        onClose={(_event, reason: SnackbarCloseReason) => {
          if (reason !== 'clickaway') shell.closeFolderError();
        }}
      >
        <Alert severity="error" onClose={shell.closeFolderError}>{shell.folderError}</Alert>
      </Snackbar>
      {overlays}
      {renderModals?.({ modal, close: () => setModal(null), open: setModal })}
    </>
  );
};
