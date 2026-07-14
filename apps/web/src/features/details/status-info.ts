import { type DetailsVideo } from './details-video.js';

export const statusDescription = (status: DetailsVideo['status'], analyzing: boolean): string => {
  if (analyzing) return 'Video is being processed…';
  switch (status) {
    case 'completed':
      return 'Analysis complete. Summary, transcript, and frames are available.';
    case 'error':
      return 'An error occurred during processing.';
    case 'pending':
      return 'Ready to be analyzed.';
    case 'frames_extracted':
      return 'Processing was interrupted at frames extraction step. Click Analyze to continue.';
    case 'audio_extracted':
      return 'Processing was interrupted at audio extraction step. Click Analyze to continue.';
    case 'transcribed':
      return 'Processing was interrupted at transcription step. Click Analyze to continue.';
    case 'analyzed':
      return 'Processing was interrupted at analysis step. Click Analyze to continue.';
    case 'not_tracked':
      return 'This video has not been processed yet.';
  }
};
