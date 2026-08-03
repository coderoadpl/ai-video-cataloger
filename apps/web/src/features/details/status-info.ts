import { type Dictionary } from '../../i18n/dictionary.js';
import { type DetailsVideo } from './details-video.js';

export const statusDescription = (
  dictionary: Dictionary,
  status: DetailsVideo['status'],
  analyzing: boolean,
  artifacts: DetailsVideo['artifacts'],
): string => {
  if (analyzing) return dictionary.details.status.analyzing;
  switch (status) {
    case 'completed':
      return dictionary.details.status.completed({
        transcript: artifacts.transcriptContent !== null && artifacts.transcriptContent.length > 0,
        frames: (artifacts.framePaths ?? []).length > 0,
      });
    case 'error':
      return dictionary.details.status.error;
    case 'pending':
      return dictionary.details.status.pending;
    case 'frames_extracted':
      return dictionary.details.status.framesExtracted;
    case 'audio_extracted':
      return dictionary.details.status.audioExtracted;
    case 'transcribed':
      return dictionary.details.status.transcribed;
    case 'analyzed':
      return dictionary.details.status.analyzed;
    case 'not_tracked':
      return dictionary.details.status.notTracked;
  }
};
