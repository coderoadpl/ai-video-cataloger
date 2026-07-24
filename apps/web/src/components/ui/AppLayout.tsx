import { useCallback, useState, type ReactNode } from 'react';
import { Box, Button, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { ResizablePanel } from './ResizablePanel.js';

export const SIDEBAR_DEFAULT_SIZE = 440;
export const SIDEBAR_MIN_SIZE = 280;
export const SIDEBAR_MAX_SIZE = 640;
export const TERMINAL_DEFAULT_SIZE = 200;
export const TERMINAL_MIN_SIZE = 100;
export const TERMINAL_MAX_SIZE = 500;

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
  header: ReactNode;
  sidebar: ReactNode;
  content: ReactNode;
  navigation?: ReactNode;
  terminal: ReactNode;
  sidebarCollapsed: boolean;
  terminalCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleTerminal: () => void;
  showJson?: boolean;
  onShowJsonChange?: (show: boolean) => void;
  onTerminalCopy?: () => void;
  onTerminalClear?: () => void;
}

export const AppLayout = ({
  header,
  sidebar,
  content,
  navigation,
  terminal,
  sidebarCollapsed,
  terminalCollapsed,
  onToggleSidebar,
  onToggleTerminal,
  showJson = false,
  onShowJsonChange,
  onTerminalCopy,
  onTerminalClear,
}: AppLayoutProps) => {
  const dictionary = useDictionary();
  const [sidebarSize, setSidebarSize] = useState(readSidebarWidth);
  const [terminalSize, setTerminalSize] = useState(TERMINAL_DEFAULT_SIZE);

  const onSidebarResize = useCallback((size: number) => {
    setSidebarSize(size);
    writeSidebarWidth(size);
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {header}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <ResizablePanel
          direction="horizontal"
          size={sidebarSize}
          minSize={SIDEBAR_MIN_SIZE}
          maxSize={SIDEBAR_MAX_SIZE}
          collapsed={sidebarCollapsed}
          onResize={onSidebarResize}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              bgcolor: 'background.paper',
              borderRight: 1,
              borderColor: 'divider',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                px: 2,
                py: 1.25,
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Typography variant="h2">{dictionary.appFrame.sidebarHeading}</Typography>
                <Button size="small" color="inherit" onClick={onToggleSidebar}>
                  {dictionary.appFrame.hideSidebar}
                </Button>
              </Box>
              {navigation}
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto' }}>{sidebar}</Box>
          </Box>
        </ResizablePanel>

        {sidebarCollapsed ? (
          <Box sx={{ pt: 1.5, pl: 1 }}>
            <Button size="small" color="inherit" onClick={onToggleSidebar}>
              {dictionary.appFrame.showSidebar}
            </Button>
          </Box>
        ) : null}

        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto' }}>{content}</Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', borderTop: 1, borderColor: 'divider' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 0.75,
            bgcolor: 'grey.900',
          }}
        >
          <Typography variant="caption" sx={{ color: 'grey.300' }}>
            {dictionary.appFrame.terminalTitle}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {!terminalCollapsed && onShowJsonChange ? (
              <Button
                size="small"
                sx={{ color: showJson ? 'primary.light' : 'grey.400', minWidth: 0 }}
                onClick={() => onShowJsonChange(!showJson)}
              >
                {dictionary.appFrame.terminalJson}
              </Button>
            ) : null}
            {!terminalCollapsed && onTerminalCopy ? (
              <Button size="small" sx={{ color: 'grey.400', minWidth: 0 }} onClick={onTerminalCopy}>
                {dictionary.appFrame.terminalCopy}
              </Button>
            ) : null}
            {!terminalCollapsed && onTerminalClear ? (
              <Button size="small" sx={{ color: 'grey.400', minWidth: 0 }} onClick={onTerminalClear}>
                {dictionary.appFrame.terminalClear}
              </Button>
            ) : null}
            <Button size="small" sx={{ color: 'grey.400', minWidth: 0 }} onClick={onToggleTerminal}>
              {terminalCollapsed ? dictionary.appFrame.terminalExpand : dictionary.appFrame.terminalCollapse}
            </Button>
          </Box>
        </Box>
        <ResizablePanel
          direction="vertical"
          size={terminalSize}
          minSize={TERMINAL_MIN_SIZE}
          maxSize={TERMINAL_MAX_SIZE}
          collapsed={terminalCollapsed}
          onResize={setTerminalSize}
        >
          <Box sx={{ height: '100%', bgcolor: 'grey.900', overflow: 'auto' }}>{terminal}</Box>
        </ResizablePanel>
      </Box>
    </Box>
  );
};
