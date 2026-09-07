import { useDictionary } from '../../i18n/use-dictionary.js';
import { EmptyState } from './EmptyState.js';
import { FilmIcon, ImageIcon } from './icons.js';

interface AnalysisEmptyStateProps {
  media: 'video' | 'photo';
  empty: boolean;
}

export const AnalysisEmptyState = ({ media, empty }: AnalysisEmptyStateProps) => {
  const dictionary = useDictionary();
  const isVideo = media === 'video';
  const title = isVideo ? dictionary.library.mediaVideo : dictionary.library.mediaPhoto;
  const message = isVideo
    ? empty ? dictionary.analysisEmptyState.noVideos : dictionary.analysisEmptyState.selectVideo
    : empty ? dictionary.analysisEmptyState.noPhotos : dictionary.analysisEmptyState.selectPhoto;

  return (
    <EmptyState
      variant="pane"
      testId="analysis-empty-state"
      title={title}
      body={message}
      icon={isVideo
        ? <FilmIcon sx={{ color: 'status.notTracked.main' }} />
        : <ImageIcon sx={{ color: 'status.notTracked.main' }} />}
    />
  );
};
