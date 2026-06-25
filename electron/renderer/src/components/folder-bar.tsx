/**
 * FolderBar - "Open Folder" split button with the recent-folders dropdown,
 * extracted from the App toolbar. The click-outside listener uses a ref on
 * the dropdown container instead of the old `.relative` class selector.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FolderOpen, ChevronDown } from 'lucide-react';

// Get folder display name (last path component)
export function getFolderName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

interface FolderBarProps {
  recentFolders: string[];
  isCheckingFolder: boolean;
  onOpenFolder: () => void;
  onSelectRecentFolder: (folderPath: string) => void;
}

export function FolderBar({
  recentFolders,
  isCheckingFolder,
  onOpenFolder,
  onSelectRecentFolder,
}: FolderBarProps): JSX.Element {
  const [showRecentMenu, setShowRecentMenu] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close recent menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowRecentMenu(false);
      }
    };
    if (showRecentMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showRecentMenu]);

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex">
        <Button
          size="sm"
          onClick={onOpenFolder}
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
                onClick={() => {
                  setShowRecentMenu(false);
                  onSelectRecentFolder(folder);
                }}
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
  );
}
