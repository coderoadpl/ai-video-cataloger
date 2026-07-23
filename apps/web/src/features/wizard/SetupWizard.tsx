import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Step,
  StepLabel,
  Stepper,
} from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { useWizard } from './use-wizard.js';
import { WIZARD_STEPS, wizardNextLabel, wizardStepLabels } from './wizard-model.js';
import { WelcomeStep } from './WelcomeStep.js';
import { AnalyzerStep } from './AnalyzerStep.js';
import { TranscriptionStep } from './TranscriptionStep.js';
import { DownloadsStep } from './DownloadsStep.js';
import { ReadinessStep } from './ReadinessStep.js';
import { DoneStep } from './DoneStep.js';

export interface SetupWizardProps {
  open: boolean;
  folder: string | null;
  onClose: () => void;
}

export const SetupWizard = ({ open, folder, onClose }: SetupWizardProps) => {
  const dictionary = useDictionary();
  const controller = useWizard({ open, folder, onFinish: onClose });
  const { step } = controller;
  const activeStep = WIZARD_STEPS.indexOf(step);
  const stepLabels = wizardStepLabels(dictionary);
  const nextLabel = wizardNextLabel(dictionary, step, controller.plannedDownloadLabels.length > 0);

  const nextDisabled =
    controller.validation === 'testing' ||
    controller.isDownloading ||
    (step === 'readiness' && controller.isCheckingReadiness) ||
    (step === 'analyzer' && controller.analyzerFamily === 'api' && controller.apiDraft.model.trim().length === 0) ||
    (step === 'transcription' &&
      controller.transcriptionMode === 'own' &&
      controller.whisperBinaryPath.trim().length === 0);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="setup-wizard">
      <DialogTitle>{dictionary.wizard.setupWizard}</DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3 }}>
          {WIZARD_STEPS.map((wizardStep) => (
            <Step key={wizardStep}>
              <StepLabel>{stepLabels[wizardStep]}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {step === 'welcome' ? <WelcomeStep /> : null}
        {step === 'analyzer' ? <AnalyzerStep controller={controller} /> : null}
        {step === 'transcription' ? <TranscriptionStep controller={controller} /> : null}
        {step === 'downloads' ? <DownloadsStep controller={controller} /> : null}
        {step === 'readiness' ? <ReadinessStep controller={controller} /> : null}
        {step === 'done' ? <DoneStep controller={controller} /> : null}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button onClick={onClose} color="inherit" data-testid="wizard-configure-later">
          {dictionary.wizard.configureLater}
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={controller.back} disabled={!controller.canGoBack} data-testid="wizard-back">
            {dictionary.wizard.back}
          </Button>
          <Button
            variant="contained"
            onClick={controller.next}
            disabled={nextDisabled}
            data-testid="wizard-next"
          >
            {nextLabel}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
