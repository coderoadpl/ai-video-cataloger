import { type ReactNode } from 'react';
import { Box } from '@mui/material';

import { ResizablePanel } from '../ui/ResizablePanel.js';

export const SIDEBAR_DEFAULT_SIZE = 440;
export const SIDEBAR_MIN_SIZE = 280;
export const SIDEBAR_MAX_SIZE = 640;
export const TERMINAL_DEFAULT_SIZE = 200;
export const TERMINAL_MIN_SIZE = 100;
export const TERMINAL_MAX_SIZE = 500;

interface AppShellProps {
  header: ReactNode;
  sidebarHeading: ReactNode;
  sidebarAction: ReactNode;
  sidebarExpandAction: ReactNode;
  navigation?: ReactNode;
  sidebar: ReactNode;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  onSidebarResize: (size: number) => void;
  banner?: ReactNode;
  content: ReactNode;
  terminalTitle: ReactNode;
  terminalActions: ReactNode;
  terminal: ReactNode;
  terminalCollapsed: boolean;
  terminalHeight: number;
  onTerminalResize: (size: number) => void;
}

export const AppShell = ({
  header,
  sidebarHeading,
  sidebarAction,
  sidebarExpandAction,
  navigation,
  sidebar,
  sidebarCollapsed,
  sidebarWidth,
  onSidebarResize,
  banner,
  content,
  terminalTitle,
  terminalActions,
  terminal,
  terminalCollapsed,
  terminalHeight,
  onTerminalResize,
}: AppShellProps) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
    {header}
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <ResizablePanel
        direction="horizontal"
        size={sidebarWidth}
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
              {sidebarHeading}
              {sidebarAction}
            </Box>
            {navigation}
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto' }}>{sidebar}</Box>
        </Box>
      </ResizablePanel>

      {sidebarCollapsed ? <Box sx={{ pt: 1.5, pl: 1 }}>{sidebarExpandAction}</Box> : null}

      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        {banner}
        {content}
      </Box>
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
        {terminalTitle}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>{terminalActions}</Box>
      </Box>
      <ResizablePanel
        direction="vertical"
        size={terminalHeight}
        minSize={TERMINAL_MIN_SIZE}
        maxSize={TERMINAL_MAX_SIZE}
        collapsed={terminalCollapsed}
        onResize={onTerminalResize}
      >
        <Box sx={{ height: '100%', bgcolor: 'grey.900', overflow: 'auto' }}>{terminal}</Box>
      </ResizablePanel>
    </Box>
  </Box>
);
