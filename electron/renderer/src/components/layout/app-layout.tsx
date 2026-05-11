import * as React from 'react';
import { cn } from '@/lib/utils';
import { ResizablePanel } from './resizable-panel';
import { Button } from '@/components/ui/button';
import { ChevronUp, ChevronDown, PanelLeftClose, PanelLeft, Copy, Trash2, Check, Braces } from 'lucide-react';

interface AppLayoutProps {
  sidebar: React.ReactNode;
  content: React.ReactNode;
  terminal: React.ReactNode;
  className?: string;
  terminalCollapsed?: boolean;
  onTerminalCollapsedChange?: (collapsed: boolean) => void;
  sidebarCollapsed?: boolean;
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  onTerminalClear?: () => void;
  onTerminalCopy?: () => Promise<void> | void;
  showJson?: boolean;
  onShowJsonChange?: (show: boolean) => void;
}

const SIDEBAR_DEFAULT_SIZE = 280;
const SIDEBAR_MIN_SIZE = 200;
const SIDEBAR_MAX_SIZE = 400;
const TERMINAL_DEFAULT_SIZE = 200;
const TERMINAL_MIN_SIZE = 100;
const TERMINAL_MAX_SIZE = 500;

const AppLayout = React.forwardRef<HTMLDivElement, AppLayoutProps>(
  (
    {
      sidebar,
      content,
      terminal,
      className,
      terminalCollapsed = false,
      onTerminalCollapsedChange,
      sidebarCollapsed = false,
      onSidebarCollapsedChange,
      onTerminalClear,
      onTerminalCopy,
      showJson = false,
      onShowJsonChange,
    },
    ref
  ) => {
    const [copied, setCopied] = React.useState(false);

    const handleTerminalToggle = React.useCallback(() => {
      onTerminalCollapsedChange?.(!terminalCollapsed);
    }, [terminalCollapsed, onTerminalCollapsedChange]);

    const handleSidebarToggle = React.useCallback(() => {
      onSidebarCollapsedChange?.(!sidebarCollapsed);
    }, [sidebarCollapsed, onSidebarCollapsedChange]);

    const handleTerminalCopy = React.useCallback(async () => {
      if (onTerminalCopy) {
        await onTerminalCopy();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }, [onTerminalCopy]);

    return (
      <div ref={ref} className={cn('flex flex-col h-screen overflow-hidden', className)}>
        {/* Main area with sidebar and content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <ResizablePanel
            direction="horizontal"
            defaultSize={SIDEBAR_DEFAULT_SIZE}
            minSize={SIDEBAR_MIN_SIZE}
            maxSize={SIDEBAR_MAX_SIZE}
            collapsed={sidebarCollapsed}
            className="bg-card border-r border-border"
          >
            <div className="flex flex-col h-full">
              {/* Sidebar toggle button (visible when collapsed) */}
              {sidebarCollapsed && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSidebarToggle}
                  className="absolute left-2 top-2 z-10"
                  title="Show sidebar"
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
              )}
              {/* Sidebar header with toggle */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="font-semibold text-sm">Videos</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSidebarToggle}
                  className="h-6 w-6 p-0"
                  title="Hide sidebar"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </div>
              {/* Sidebar content */}
              <div className="flex-1 overflow-auto scrollbar-macos">{sidebar}</div>
            </div>
          </ResizablePanel>

          {/* Show sidebar button when collapsed */}
          {sidebarCollapsed && (
            <div className="flex items-start pt-3 pl-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSidebarToggle}
                className="h-8 w-8 p-0"
                title="Show sidebar"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Main content area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Content */}
            <div className="flex-1 overflow-auto scrollbar-macos">{content}</div>
          </div>
        </div>

        {/* Terminal panel (bottom) */}
        <div className="flex flex-col border-t border-border">
          {/* Terminal header with toggle */}
          <div className="flex items-center justify-between px-4 py-2 bg-[#1e1e1e] border-b border-border/50">
            <span className="text-sm font-medium text-gray-300">Terminal</span>
            <div className="flex items-center gap-2">
              {!terminalCollapsed && onShowJsonChange && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onShowJsonChange(!showJson)}
                  className={cn(
                    "h-6 px-2 text-xs gap-1",
                    showJson
                      ? "text-cyan-400 hover:text-cyan-300 hover:bg-white/10"
                      : "text-gray-400 hover:text-gray-200 hover:bg-white/10"
                  )}
                  title={showJson ? "Hide JSON output" : "Show JSON output"}
                >
                  <Braces className="h-3.5 w-3.5" />
                  <span>JSON</span>
                </Button>
              )}
              {!terminalCollapsed && onTerminalCopy && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleTerminalCopy}
                  className="h-6 w-6 p-0 text-gray-400 hover:text-gray-200 hover:bg-white/10"
                  title="Copy log contents"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
              {!terminalCollapsed && onTerminalClear && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onTerminalClear}
                  className="h-6 w-6 p-0 text-gray-400 hover:text-gray-200 hover:bg-white/10"
                  title="Clear log"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTerminalToggle}
                className="h-6 w-6 p-0 text-gray-400 hover:text-gray-200 hover:bg-white/10"
                title={terminalCollapsed ? 'Expand terminal' : 'Collapse terminal'}
              >
                {terminalCollapsed ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Terminal content (resizable) */}
          <ResizablePanel
            direction="vertical"
            defaultSize={TERMINAL_DEFAULT_SIZE}
            minSize={TERMINAL_MIN_SIZE}
            maxSize={TERMINAL_MAX_SIZE}
            collapsed={terminalCollapsed}
            className="bg-[#1e1e1e]"
          >
            {terminal}
          </ResizablePanel>
        </div>
      </div>
    );
  }
);
AppLayout.displayName = 'AppLayout';

export { AppLayout };
export type { AppLayoutProps };
