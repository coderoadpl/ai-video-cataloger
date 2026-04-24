import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { TerminalLog, LogLine, createLogLine } from '@/components/terminal-log';
import { AppLayout } from '@/components/layout';
import { FolderOpen, Settings, HelpCircle } from 'lucide-react';

function App(): JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('');
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion).catch(console.error);
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

  // Sidebar content
  const sidebarContent = (
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
          <Button size="sm">
            <FolderOpen className="h-4 w-4 mr-2" />
            Open Folder
          </Button>
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

  return (
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
  );
}

export default App;
