import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

function App(): JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion).catch(console.error);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center gap-3 px-6 py-4 bg-card border-b border-border">
        <h1 className="text-xl font-semibold">AI Video Cataloger</h1>
        {appVersion && <span className="text-xs text-muted-foreground">v{appVersion}</span>}
      </header>
      <main className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <p className="text-foreground">Welcome to AI Video Cataloger</p>
        <p className="text-sm text-muted-foreground">
          Running on {window.electronAPI?.platform ?? 'unknown platform'}
        </p>

        {/* Demo components */}
        <div className="flex flex-col gap-4 w-full max-w-sm">
          <Input placeholder="Search videos..." />
          <div className="flex gap-2">
            <Button>Open Folder</Button>
            <Button variant="secondary">Settings</Button>
            <Button variant="outline">Help</Button>
          </div>
        </div>

        <ScrollArea className="h-32 w-full max-w-sm rounded-md border border-border p-4">
          <div className="text-sm text-muted-foreground">
            <p className="mb-2">This is a scroll area component.</p>
            <p className="mb-2">It provides native-feeling scrolling behavior.</p>
            <p className="mb-2">Perfect for lists and log viewers.</p>
            <p className="mb-2">Styled to match macOS aesthetics.</p>
            <p className="mb-2">With subtle scrollbar appearance.</p>
            <p>And smooth scrolling behavior.</p>
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}

export default App;
