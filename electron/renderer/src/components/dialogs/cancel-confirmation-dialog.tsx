/**
 * CancelConfirmationDialog - confirmation before cancelling a running
 * analysis (single video or whole batch). Extracted from App.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle } from 'lucide-react';
import type { CancelConfirmation } from '@/hooks/use-batch-processor';

interface CancelConfirmationDialogProps {
  confirmation: CancelConfirmation;
  onClose: () => void;
  onConfirmSingle: () => void;
  onConfirmBatch: () => void;
}

export function CancelConfirmationDialog({
  confirmation,
  onClose,
  onConfirmSingle,
  onConfirmBatch,
}: CancelConfirmationDialogProps): JSX.Element {
  return (
    <AlertDialog open={confirmation.open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            {confirmation.isBatch ? 'Cancel Batch Processing?' : 'Cancel Processing?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <div className="space-y-3">
              {confirmation.isBatch ? (
                <>
                  <p>
                    Are you sure you want to cancel the batch analysis?
                    This will stop after the current video finishes processing.
                  </p>
                  <p className="text-amber-600">
                    Warning: The current video may be left in an incomplete state.
                    Already processed videos will keep their results.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Are you sure you want to cancel the current video analysis?
                  </p>
                  <p className="text-amber-600">
                    Warning: This may leave the video in an incomplete state.
                    Partial data (extracted frames, audio, etc.) may remain and you may need to
                    re-analyze the video from the beginning.
                  </p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>
            Continue Processing
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmation.isBatch ? onConfirmBatch : onConfirmSingle}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {confirmation.isBatch ? 'Stop Batch' : 'Cancel Analysis'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
