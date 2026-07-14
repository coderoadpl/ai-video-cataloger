// The legacy Claude-specific event id is analyzer-agnostic for stream compatibility.
const STEP_LABELS: Record<string, string> = {
  extracting_frames: 'Extracting frames',
  extracting_audio: 'Extracting audio',
  transcribing_audio: 'Transcribing audio',
  analyzing_with_claude: 'Analyzing with AI',
  renaming_video: 'Renaming video',
  skipping_rename: 'Finalizing',
  downloading: 'Downloading',
  runtime_setup: 'Preparing runtime',
  model_download: 'Downloading model',
};

export const stepLabel = (step: string): string =>
  STEP_LABELS[step] ?? step.replace(/_/g, ' ');
