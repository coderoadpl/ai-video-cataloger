import { BatchSummaryDialog } from '../../components/ui/dialogs/BatchSummaryDialog.js';
import { DriveSummaryDialog } from '../../components/ui/dialogs/DriveSummaryDialog.js';
import { CancelConfirmationDialog } from '../../components/ui/dialogs/CancelConfirmationDialog.js';
import type { ProcessingState } from './use-processing.js';

export const ProcessingDialogs = ({ processing }: { processing: ProcessingState }) => (
  <>
      <CancelConfirmationDialog
        confirmation={processing.cancelConfirmation}
        onClose={processing.closeCancelDialog}
        onConfirm={processing.confirmCancel}
      />
      <BatchSummaryDialog
        open={processing.batchSummary.open}
        results={processing.batchSummary.results}
        onClose={processing.closeBatchSummary}
      />
      <DriveSummaryDialog
        open={processing.driveSummary.open}
        counts={processing.driveSummary.counts}
        onClose={processing.closeDriveSummary}
      />
  </>
);
