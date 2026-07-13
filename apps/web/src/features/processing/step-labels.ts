/**
 * Human labels for the pipeline's progress step ids. The NDJSON step id
 * `analyzing_with_claude` fires even for the local analyzer (sanctioned
 * deviation #2 in the PRD: keep the id for stream compat, fix the human label to
 * the analyzer-neutral "Analyzing with AI"). Unknown ids degrade to their id
 * with underscores turned to spaces.
 */
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
