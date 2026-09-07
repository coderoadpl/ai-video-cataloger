import { Box, Button } from '@mui/material';

import { MediaViewerShell } from '../../components/ui/MediaViewerShell.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { viewerTitle, type LibraryItem } from './core/index.js';
import { LibraryPhotoDetails, LibraryPhotoStage } from './LibraryPhotoPane.js';
import { LibraryVideoDetails, LibraryVideoStage } from './LibraryVideoPane.js';

interface LibraryMediaViewerProps {
  item: LibraryItem;
  onClose: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  onOpenInAnalysis: () => void;
}

export const LibraryMediaViewer = ({
  item,
  onClose,
  onPrevious,
  onNext,
  onOpenInAnalysis,
}: LibraryMediaViewerProps) => {
  const dictionary = useDictionary();
  const capturedAt = formatCapturedAt(item.capturedAt, dictionary.locale);
  const title = viewerTitle(item);

  return (
    <MediaViewerShell
      testId="library-media-viewer"
      title={title}
      caption={capturedAt === null ? title : `${title} · ${capturedAt}`}
      captionTestId="library-media-viewer-caption"
      onClose={onClose}
      closeLabel={dictionary.library.viewerClose}
      closeTestId="library-media-viewer-close"
      previousLabel={dictionary.library.viewerPrevious}
      nextLabel={dictionary.library.viewerNext}
      previousTestId="library-media-viewer-previous"
      nextTestId="library-media-viewer-next"
      onPrevious={onPrevious}
      onNext={onNext}
      surfaceProps={{ 'data-media': item.media, 'data-fingerprint': item.fingerprint }}
      headerAction={(
        <Button
          variant="outlined"
          size="small"
          onClick={onOpenInAnalysis}
          data-testid="library-media-viewer-open-analysis"
        >
          {dictionary.library.openInAnalysis}
        </Button>
      )}
      stage={item.media === 'video' ? <LibraryVideoStage item={item} /> : <LibraryPhotoStage item={item} />}
      side={(
        <Box
          data-testid="library-media-viewer-details"
          sx={{
            width: 340,
            flexShrink: 0,
            maxWidth: '38%',
            borderLeft: 1,
            borderColor: 'divider',
            p: 2,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {item.media === 'video' ? <LibraryVideoDetails item={item} /> : <LibraryPhotoDetails item={item} />}
        </Box>
      )}
    />
  );
};
