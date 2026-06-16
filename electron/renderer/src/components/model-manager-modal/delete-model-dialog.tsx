/**
 * DeleteModelDialog - confirmation dialog before deleting a Whisper model.
 * Extracted from model-manager-modal.tsx.
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

interface DeleteModelDialogProps {
  open: boolean;
  modelName: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteModelDialog({
  open,
  modelName,
  onClose,
  onConfirm,
}: DeleteModelDialogProps): JSX.Element {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Delete Model?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the &quot;{modelName}&quot; model? You will
            need to download it again if you want to use it for transcription.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete Model
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
