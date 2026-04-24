import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { TerminalLog, LogLine, createLogLine } from '@/components/terminal-log';
import { AppLayout } from '@/components/layout';
import { FolderOpen, Settings, HelpCircle, AlertTriangle, ChevronDown, Folder } from 'lucide-react';

interface JsonEvent {
  type: 'started' | 'progress' | 'completed' | 'error';
  timestamp: string;
  message?: string;
  step?: string;
  percentage?: number;
  current?: number;
  total?: number;
  data?: Record<string, unknown>;
  error?: string;
  code?: string;
}

interface NestedDbError {
  open: boolean;
  paths: string[];
}

function App(): JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('');
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [nestedDbError, setNestedDbError] = useState<NestedDbError>({ open: false, paths: [] });
  const [showRecentMenu, setShowRecentMenu] = useState(false);
  const [isCheckingFolder, setIsCheckingFolder] = useState(false);

  // Load initial state
  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion).catch(console.error);
    window.electronAPI?.folder.getCurrent().then(setCurrentFolder).catch(console.error);
    window.electronAPI?.folder.getRecent().then(setRecentFolders).catch(console.error);
  }, []);

  const handleClear = useCallback(() => {
    setLogLines([]);
  }, []);

  const handleCopy = useCallback(async () => {
    // Strip ANSI codes when copying
    const plainText = logLines
      .map((line) => line.content.replace(/\x1b\[[0-9;]*m/g, ''))
      .join('\n');
    await navigator.clipboard.writeText(plainText);
  }, [logLines]);

  const addLogLine = useCallback((content: string, type: LogLine['type'] = 'stdout') => {
    setLogLines((prev) => [...prev, createLogLine(content, type)]);
  }, []);

  const handleDemoOutput = useCallback(() => {
    addLogLine('\x1b[32m✓\x1b[0m Starting video analysis...', 'info');
    addLogLine('Processing: BigBuckBunny.mp4', 'stdout');
    addLogLine('\x1b[33m⚠\x1b[0m Frame extraction: 25% complete', 'stdout');
    addLogLine('\x1b[33m⚠\x1b[0m Frame extraction: 50% complete', 'stdout');
    addLogLine('\x1b[33m⚠\x1b[0m Frame extraction: 75% complete', 'stdout');
    addLogLine('\x1b[32m✓\x1b[0m Frame extraction: 100% complete', 'success');
    addLogLine('\x1b[1m\x1b[34mTranscribing audio with Whisper...\x1b[0m', 'info');
  }, [addLogLine]);

  const handleDemoError = useCallback(() => {
    addLogLine('\x1b[31mError:\x1b[0m Failed to connect to Ollama', 'error');
    addLogLine('\x1b[31m  └─\x1b[0m Is Ollama running? Try: ollama serve', 'stderr');
  }, [addLogLine]);

  // Check folder for nested databases using CLI
  const checkFolderForNestedDbs = useCallback(
    async (folderPath: string): Promise<{ valid: boolean; nestedPaths: string[] }> => {
      return new Promise((resolve) => {
        setIsCheckingFolder(true);
        addLogLine(`\x1b[36mChecking folder for nested databases...\x1b[0m`, 'info');

        let nestedPaths: string[] = [];
        let hasError = false;

        const handleOutput = (_spawnId: string, line: string): void => {
          addLogLine(line, 'stdout');
        };

        const handleJson = (_spawnId: string, event: JsonEvent): void => {
          if (event.type === 'completed' && event.data) {
            const paths = event.data.nestedDatabases;
            if (Array.isArray(paths) && paths.length > 0) {
              nestedPaths = paths as string[];
            }
          } else if (event.type === 'error') {
            hasError = true;
            addLogLine(`\x1b[31mError:\x1b[0m ${event.error || event.message}`, 'error');
          }
        };

        const handleExit = (_spawnId: string, code: number | null): void => {
          cleanupListeners();
          setIsCheckingFolder(false);

          if (hasError || code !== 0) {
            if (nestedPaths.length > 0) {
              resolve({ valid: false, nestedPaths });
            } else {
              resolve({ valid: false, nestedPaths: [] });
            }
          } else {
            resolve({ valid: true, nestedPaths: [] });
          }
        };

        // Set up listeners
        const cleanupStdout = window.electronAPI?.cli.onStdout(handleOutput);
        const cleanupJson = window.electronAPI?.cli.onJson(handleJson);
        const cleanupExit = window.electronAPI?.cli.onExit(handleExit);

        const cleanupListeners = (): void => {
          cleanupStdout?.();
          cleanupJson?.();
          cleanupExit?.();
        };

        // Spawn the check command
        window.electronAPI?.cli
          .spawn(['check', folderPath], { json: true })
          .catch((err: Error) => {
            addLogLine(`\x1b[31mError:\x1b[0m Failed to run check: ${err.message}`, 'error');
            cleanupListeners();
            setIsCheckingFolder(false);
            resolve({ valid: false, nestedPaths: [] });
          });
      });
    },
    [addLogLine]
  );

  // Handle folder selection
  const handleOpenFolder = useCallback(async () => {
    const selectedPath = await window.electronAPI?.folder.showPicker();
    if (!selectedPath) return;

    // Check for nested databases
    const result = await checkFolderForNestedDbs(selectedPath);

    if (!result.valid && result.nestedPaths.length > 0) {
      // Show error modal with nested paths
      setNestedDbError({ open: true, paths: result.nestedPaths });
      return;
    }

    if (!result.valid) {
      // Check failed for other reasons
      addLogLine(`\x1b[31mFailed to validate folder.\x1b[0m`, 'error');
      return;
    }

    // Folder is valid, set it as current
    await window.electronAPI?.folder.setCurrent(selectedPath);
    setCurrentFolder(selectedPath);
    setRecentFolders(await window.electronAPI?.folder.getRecent() || []);
    addLogLine(`\x1b[32m✓\x1b[0m Opened folder: ${selectedPath}`, 'success');
  }, [checkFolderForNestedDbs, addLogLine]);

  // Handle selecting a recent folder
  const handleSelectRecentFolder = useCallback(
    async (folderPath: string) => {
      setShowRecentMenu(false);

      // Check for nested databases
      const result = await checkFolderForNestedDbs(folderPath);

      if (!result.valid && result.nestedPaths.length > 0) {
        setNestedDbError({ open: true, paths: result.nestedPaths });
        return;
      }

      if (!result.valid) {
        addLogLine(`\x1b[31mFailed to validate folder.\x1b[0m`, 'error');
        return;
      }

      await window.electronAPI?.folder.setCurrent(folderPath);
      setCurrentFolder(folderPath);
      setRecentFolders(await window.electronAPI?.folder.getRecent() || []);
      addLogLine(`\x1b[32m✓\x1b[0m Opened folder: ${folderPath}`, 'success');
    },
    [checkFolderForNestedDbs, addLogLine]
  );

  // Close nested DB error dialog
  const handleCloseNestedDbError = useCallback(() => {
    setNestedDbError({ open: false, paths: [] });
  }, []);

  // Get folder display name (last path component)
  const getFolderName = (path: string): string => {
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  };

  // Sidebar content
  const sidebarContent = currentFolder ? (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Folder className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm truncate" title={currentFolder}>
            {getFolderName(currentFolder)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate" title={currentFolder}>
          {currentFolder}
        </p>
      </div>
      <div className="border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">
          Video list will appear here after folder scan.
        </p>
      </div>
    </div>
  ) : (
    <div className="p-4 space-y-2">
      <p className="text-sm text-muted-foreground">No folder selected</p>
      <p className="text-xs text-muted-foreground">
        Click "Open Folder" to select a video folder.
      </p>
    </div>
  );

  // Main content
  const mainContent = (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <header className="flex items-center gap-3 px-6 py-3 bg-card border-b border-border">
        <h1 className="text-lg font-semibold">AI Video Cataloger</h1>
        {appVersion && <span className="text-xs text-muted-foreground">v{appVersion}</span>}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {/* Open Folder button with recent folders dropdown */}
          <div className="relative">
            <div className="flex">
              <Button
                size="sm"
                onClick={handleOpenFolder}
                disabled={isCheckingFolder}
                className="rounded-r-none"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                {isCheckingFolder ? 'Checking...' : 'Open Folder'}
              </Button>
              {recentFolders.length > 0 && (
                <Button
                  size="sm"
                  variant="default"
                  className="rounded-l-none border-l border-primary-foreground/20 px-2"
                  onClick={() => setShowRecentMenu(!showRecentMenu)}
                  disabled={isCheckingFolder}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              )}
            </div>
            {/* Recent folders dropdown */}
            {showRecentMenu && recentFolders.length > 0 && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-md shadow-lg z-50">
                <div className="p-2">
                  <p className="text-xs font-medium text-muted-foreground px-2 pb-2">
                    Recent Folders
                  </p>
                  {recentFolders.map((folder, index) => (
                    <button
                      key={index}
                      className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded-sm truncate"
                      onClick={() => handleSelectRecentFolder(folder)}
                      title={folder}
                    >
                      {getFolderName(folder)}
                      <span className="block text-xs text-muted-foreground truncate">
                        {folder}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button variant="ghost" size="sm">
            <HelpCircle className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Content area */}
      <main className="flex-1 p-6 overflow-auto scrollbar-macos">
        <div className="max-w-3xl space-y-6">
          {/* Welcome message */}
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Welcome to AI Video Cataloger</h2>
            <p className="text-muted-foreground">
              Select a folder containing videos to get started. The app will analyze your videos
              using AI to generate summaries, transcriptions, and smart file names.
            </p>
          </div>

          {/* Demo buttons for terminal */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Demo Controls</h3>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleDemoOutput}>
                Add Demo Output
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDemoError}>
                Add Demo Error
              </Button>
            </div>
          </div>

          {/* Instructions */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="font-medium">Getting Started</h3>
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
              <li>Click "Open Folder" to select a folder with video files</li>
              <li>The sidebar will show all detected videos</li>
              <li>Select a video to view details and analysis results</li>
              <li>Click "Analyze" to process individual videos</li>
              <li>Terminal output shows real-time progress</li>
            </ol>
          </div>
        </div>
      </main>
    </div>
  );

  // Terminal content
  const terminalContent = (
    <TerminalLog lines={logLines} onClear={handleClear} className="h-full" showHeader={false} />
  );

  // Close recent menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!target.closest('.relative')) {
        setShowRecentMenu(false);
      }
    };
    if (showRecentMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showRecentMenu]);

  return (
    <>
      <AppLayout
        sidebar={sidebarContent}
        content={mainContent}
        terminal={terminalContent}
        terminalCollapsed={terminalCollapsed}
        onTerminalCollapsedChange={setTerminalCollapsed}
        sidebarCollapsed={sidebarCollapsed}
        onSidebarCollapsedChange={setSidebarCollapsed}
        onTerminalClear={handleClear}
        onTerminalCopy={handleCopy}
      />

      {/* Nested Database Error Dialog */}
      <AlertDialog open={nestedDbError.open} onOpenChange={(open) => !open && handleCloseNestedDbError()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Nested Databases Detected
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  The selected folder contains nested <code className="bg-muted px-1 py-0.5 rounded">.ai-video-cataloger</code> folders.
                  This can cause data conflicts and unexpected behavior.
                </p>
                <p>Please remove or merge these nested databases before continuing:</p>
                <div className="bg-muted rounded-md p-3 max-h-40 overflow-auto">
                  <ul className="text-sm space-y-1 font-mono">
                    {nestedDbError.paths.map((path, index) => (
                      <li key={index} className="truncate" title={path}>
                        {path}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleCloseNestedDbError}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default App;
