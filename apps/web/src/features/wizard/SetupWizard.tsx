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

import { useWizard } from './use-wizard.js';
import { WIZARD_STEPS, WIZARD_STEP_LABELS } from './wizard-model.js';
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

const NEXT_LABEL: Record<string, string> = {
  welcome: 'Get started',
  analyzer: 'Continue',
  transcription: 'Continue',
  downloads: 'Install & continue',
  readiness: 'Continue',
  done: 'Finish',
};

export const SetupWizard = ({ open, folder, onClose }: SetupWizardProps) => {
  const controller = useWizard({ open, folder, onFinish: onClose });
  const { step } = controller;
  const activeStep = WIZARD_STEPS.indexOf(step);

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
      <DialogTitle>Setup Wizard</DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3 }}>
          {WIZARD_STEPS.map((wizardStep) => (
            <Step key={wizardStep}>
              <StepLabel>{WIZARD_STEP_LABELS[wizardStep]}</StepLabel>
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
          Configure later
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={controller.back} disabled={!controller.canGoBack} data-testid="wizard-back">
            Back
          </Button>
          <Button
            variant="contained"
            onClick={controller.next}
            disabled={nextDisabled}
            data-testid="wizard-next"
          >
            {NEXT_LABEL[step] ?? 'Continue'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
