import { type DetailsVideo } from './details-video.js';

import { AnalysisEmptyState } from '../../components/ui/AnalysisEmptyState.js';
import { AnalysisWelcome } from '../../components/ui/AnalysisWelcome.js';
import { DetailsSkeleton } from './DetailsSkeleton.js';
import { type DetailsLocation } from './MetadataCard.js';
import { VideoDetails } from './VideoDetails.js';

interface DetailsPanelProps {
  video: DetailsVideo | null;
  analyzing: boolean;
  loading?: boolean;
  folderOpen?: boolean;
  hasVideos?: boolean;
  onAnalyze?: ((video: DetailsVideo, options?: { force?: boolean }) => void) | undefined;
  onNavigateToCanonical?: ((canonicalPath: string) => void) | undefined;
  disabledReason?: string | undefined;
  onTagSearch?: ((tag: string) => void) | undefined;
  location?: DetailsLocation | null | undefined;
  onShowOnMap?: (() => void) | undefined;
}

export const DetailsPanel = ({
  video,
  analyzing,
  loading = false,
  folderOpen = false,
  hasVideos = false,
  onAnalyze,
  onNavigateToCanonical,
  disabledReason,
  onTagSearch,
  location,
  onShowOnMap,
}: DetailsPanelProps) => {
  if (video === null && loading) return <DetailsSkeleton />;

  return video === null ? (
    folderOpen ? <AnalysisEmptyState media="video" empty={!hasVideos} /> : <AnalysisWelcome />
  ) : (
    <VideoDetails
      key={video.path}
      video={video}
      analyzing={analyzing}
      onAnalyze={onAnalyze}
      onNavigateToCanonical={onNavigateToCanonical}
      disabledReason={disabledReason}
      onTagSearch={onTagSearch}
      location={location}
      onShowOnMap={onShowOnMap}
    />
  );
};
