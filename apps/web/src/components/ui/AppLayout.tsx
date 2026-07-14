import { useState, type ReactNode } from 'react';
import { Box, Button, Typography } from '@mui/material';

import { ResizablePanel } from './ResizablePanel.js';

export const SIDEBAR_DEFAULT_SIZE = 280;
export const SIDEBAR_MIN_SIZE = 200;
export const SIDEBAR_MAX_SIZE = 400;
export const TERMINAL_DEFAULT_SIZE = 200;
export const TERMINAL_MIN_SIZE = 100;
export const TERMINAL_MAX_SIZE = 500;

interface AppLayoutProps {
  header: ReactNode;
  sidebar: ReactNode;
  content: ReactNode;
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
  const [sidebarSize, setSidebarSize] = useState(SIDEBAR_DEFAULT_SIZE);
  const [terminalSize, setTerminalSize] = useState(TERMINAL_DEFAULT_SIZE);

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
          onResize={setSidebarSize}
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
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                py: 1.25,
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Typography variant="h2">Videos</Typography>
              <Button size="small" color="inherit" onClick={onToggleSidebar}>
                Hide
              </Button>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto' }}>{sidebar}</Box>
          </Box>
        </ResizablePanel>

        {sidebarCollapsed ? (
          <Box sx={{ pt: 1.5, pl: 1 }}>
            <Button size="small" color="inherit" onClick={onToggleSidebar}>
              Show
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
            Terminal
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {!terminalCollapsed && onShowJsonChange ? (
              <Button
                size="small"
                sx={{ color: showJson ? 'primary.light' : 'grey.400', minWidth: 0 }}
                onClick={() => onShowJsonChange(!showJson)}
              >
                JSON
              </Button>
            ) : null}
            {!terminalCollapsed && onTerminalCopy ? (
              <Button size="small" sx={{ color: 'grey.400', minWidth: 0 }} onClick={onTerminalCopy}>
                Copy
              </Button>
            ) : null}
            {!terminalCollapsed && onTerminalClear ? (
              <Button size="small" sx={{ color: 'grey.400', minWidth: 0 }} onClick={onTerminalClear}>
                Clear
              </Button>
            ) : null}
            <Button size="small" sx={{ color: 'grey.400', minWidth: 0 }} onClick={onToggleTerminal}>
              {terminalCollapsed ? 'Expand' : 'Collapse'}
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
