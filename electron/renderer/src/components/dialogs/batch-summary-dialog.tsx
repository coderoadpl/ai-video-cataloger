/**
 * BatchSummaryDialog - summary shown after a batch analysis completes
 * (success/failure counts plus the list of failed videos). Extracted
 * from App.
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
import { CheckCircle2, XOctagon } from 'lucide-react';
import type { BatchResult } from '@/hooks/use-batch-processor';

interface BatchSummaryDialogProps {
  open: boolean;
  results: BatchResult[];
  onClose: () => void;
}

export function BatchSummaryDialog({ open, results, onClose }: BatchSummaryDialogProps): JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Batch Analysis Complete
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              {/* Summary stats */}
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm">
                    <span className="font-medium text-foreground">{results.filter((r) => r.success).length}</span>
                    {' '}successful
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <XOctagon className="h-4 w-4 text-red-600" />
                  <span className="text-sm">
                    <span className="font-medium text-foreground">{results.filter((r) => !r.success).length}</span>
                    {' '}failed
                  </span>
                </div>
              </div>

              {/* Failed videos list */}
              {results.filter((r) => !r.success).length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Failed videos:</p>
                  <div className="bg-muted rounded-md p-3 max-h-40 overflow-auto">
                    <ul className="text-sm space-y-2">
                      {results.filter((r) => !r.success).map((result, index) => (
                        <li key={index} className="space-y-0.5">
                          <div className="font-medium truncate" title={result.video.filename}>
                            {result.video.filename}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {result.error || 'Unknown error'}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
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
