import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TerminalLog, LogLine, createLogLine } from '@/components/terminal-log';

function App(): JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('');
  const [logLines, setLogLines] = useState<LogLine[]>([]);

  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion).catch(console.error);
  }, []);

  const handleClear = useCallback(() => {
    setLogLines([]);
  }, []);

  const addLogLine = useCallback((content: string, type: LogLine['type'] = 'stdout') => {
    setLogLines((prev) => [...prev, createLogLine(content, type)]);
  }, []);

  const handleDemoOutput = useCallback(() => {
    // Add demo output lines with various types and ANSI colors
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

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center gap-3 px-6 py-4 bg-card border-b border-border">
        <h1 className="text-xl font-semibold">AI Video Cataloger</h1>
        {appVersion && <span className="text-xs text-muted-foreground">v{appVersion}</span>}
      </header>
      <main className="flex-1 flex flex-col p-6 gap-6">
        <div className="flex items-center gap-4">
          <p className="text-foreground">Welcome to AI Video Cataloger</p>
          <p className="text-sm text-muted-foreground">
            Running on {window.electronAPI?.platform ?? 'unknown platform'}
          </p>
        </div>

        {/* Demo components */}
        <div className="flex flex-col gap-4 w-full max-w-sm">
          <Input placeholder="Search videos..." />
          <div className="flex gap-2">
            <Button>Open Folder</Button>
            <Button variant="secondary">Settings</Button>
            <Button variant="outline">Help</Button>
          </div>
        </div>

        {/* Demo buttons for terminal */}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleDemoOutput}>
            Add Demo Output
          </Button>
          <Button variant="destructive" onClick={handleDemoError}>
            Add Demo Error
          </Button>
        </div>

        {/* Terminal Log */}
        <TerminalLog
          lines={logLines}
          onClear={handleClear}
          className="flex-1 min-h-[200px] relative"
        />
      </main>
    </div>
  );
}

export default App;
