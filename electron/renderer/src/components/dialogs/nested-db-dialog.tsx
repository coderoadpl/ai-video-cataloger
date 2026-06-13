/**
 * NestedDbDialog - error dialog shown when the selected folder contains
 * nested .ai-video-cataloger databases. Extracted from App.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle } from 'lucide-react';

interface NestedDbDialogProps {
  open: boolean;
  paths: string[];
  onClose: () => void;
}

export function NestedDbDialog({ open, paths, onClose }: NestedDbDialogProps): JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
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
                  {paths.map((path, index) => (
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
          <AlertDialogAction onClick={onClose}>
            OK
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
