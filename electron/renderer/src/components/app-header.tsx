/**
 * AppHeader - top toolbar with the app title, FolderBar and the
 * Settings / Models / Prerequisites buttons, extracted from App.
 */

import { Button } from '@/components/ui/button';
import { Settings, HelpCircle, HardDrive } from 'lucide-react';
import { FolderBar } from '@/components/folder-bar';

interface AppHeaderProps {
  appVersion: string;
  recentFolders: string[];
  isCheckingFolder: boolean;
  onOpenFolder: () => void;
  onSelectRecentFolder: (folderPath: string) => void;
  onShowSettings: () => void;
  onShowModelManager: () => void;
  onShowPrerequisites: () => void;
}

export function AppHeader({
  appVersion,
  recentFolders,
  isCheckingFolder,
  onOpenFolder,
  onSelectRecentFolder,
  onShowSettings,
  onShowModelManager,
  onShowPrerequisites,
}: AppHeaderProps): JSX.Element {
  return (
    <header className="flex items-center gap-3 px-6 py-3 bg-card border-b border-border">
      <h1 className="text-lg font-semibold">AI Video Cataloger</h1>
      {appVersion && <span className="text-xs text-muted-foreground">v{appVersion}</span>}
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {/* Open Folder button with recent folders dropdown */}
        <FolderBar
          recentFolders={recentFolders}
          isCheckingFolder={isCheckingFolder}
          onOpenFolder={onOpenFolder}
          onSelectRecentFolder={onSelectRecentFolder}
        />
        <Button variant="outline" size="sm" onClick={onShowSettings}>
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </Button>
        <Button variant="outline" size="sm" onClick={onShowModelManager}>
          <HardDrive className="h-4 w-4 mr-2" />
          Models
        </Button>
        <Button variant="ghost" size="sm" onClick={onShowPrerequisites} title="System Prerequisites">
          <HelpCircle className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
