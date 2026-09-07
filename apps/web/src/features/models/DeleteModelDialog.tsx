import { ConfirmDialog } from '../../components/ui/dialogs/ConfirmDialog.js';
import { useDictionary } from '../../i18n/use-dictionary.js';

interface DeleteModelDialogProps {
  open: boolean;
  modelName: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export const DeleteModelDialog = ({ open, modelName, onClose, onConfirm }: DeleteModelDialogProps) => {
  const dictionary = useDictionary();

  return (
    <ConfirmDialog
      open={open}
      title={dictionary.models.deleteModelTitle}
      body={dictionary.models.deleteModelText(modelName)}
      confirmLabel={dictionary.models.delete}
      testId="delete-model-confirm"
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
};
