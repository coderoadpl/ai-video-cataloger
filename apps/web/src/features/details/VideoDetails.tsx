import { Alert, Box, Button, Chip, Link, Typography } from '@mui/material';

import { DuplicateBadge } from '../../components/ui/DuplicateBadge.js';
import { VideoStatusBadge } from '../../components/ui/VideoStatusBadge.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { ArtifactsSection } from './ArtifactsSection.js';
import { type DetailsVideo } from './details-video.js';
import { MetadataCard } from './MetadataCard.js';
import { StatusActions } from './StatusActions.js';
import { statusDescription } from './status-info.js';
import { VideoPlayer } from './VideoPlayer.js';

interface VideoDetailsProps {
  video: DetailsVideo;
  analyzing: boolean;
  onAnalyze?: ((video: DetailsVideo, options?: { force?: boolean }) => void) | undefined;
  onNavigateToCanonical?: ((canonicalPath: string) => void) | undefined;
  disabledReason?: string | undefined;
  onTagSearch?: ((tag: string) => void) | undefined;
}

const DuplicateDetail = ({
  video,
  canonicalPath,
  analyzing,
  onAnalyze,
  onNavigateToCanonical,
  disabledReason,
  dictionary,
}: {
  video: DetailsVideo;
  canonicalPath: string;
  analyzing: boolean;
  onAnalyze?: ((video: DetailsVideo, options?: { force?: boolean }) => void) | undefined;
  onNavigateToCanonical?: ((canonicalPath: string) => void) | undefined;
  disabledReason?: string | undefined;
  dictionary: Dictionary;
}) => (
  <Alert severity="info" icon={false} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    <Typography variant="h2">{dictionary.details.duplicateTitle}</Typography>
    <Typography variant="body2">{dictionary.details.duplicateExplanation}</Typography>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography variant="caption" color="text.secondary">
        {dictionary.details.duplicateCanonicalLabel}
      </Typography>
      {onNavigateToCanonical === undefined ? (
        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
          {canonicalPath}
        </Typography>
      ) : (
        <Link
          component="button"
          type="button"
          variant="body2"
          align="left"
          data-testid="duplicate-canonical-link"
          onClick={() => onNavigateToCanonical(canonicalPath)}
          sx={{ wordBreak: 'break-all', textAlign: 'left' }}
        >
          {canonicalPath}
        </Link>
      )}
    </Box>
    {onAnalyze === undefined ? null : (
      <Box sx={{ mt: 1 }}>
        <Button
          data-testid="analyze-anyway-button"
          variant="outlined"
          color="inherit"
          size="small"
          disabled={analyzing || disabledReason !== undefined}
          onClick={() => onAnalyze(video, { force: true })}
        >
          {analyzing ? dictionary.details.analyzingButton : dictionary.details.analyzeAnyway}
        </Button>
        {disabledReason === undefined ? null : (
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
            {disabledReason}
          </Typography>
        )}
      </Box>
    )}
  </Alert>
);

export const VideoDetails = ({
  video,
  analyzing,
  onAnalyze,
  onNavigateToCanonical,
  disabledReason,
  onTagSearch,
}: VideoDetailsProps) => {
  const dictionary = useDictionary();
  const duplicate = video.duplicate ?? null;

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 780 }}>
      <VideoPlayer video={video} />

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography variant="h1" noWrap title={video.filename}>
            {video.filename}
          </Typography>
          <Typography variant="caption" noWrap title={video.path}>
            {video.path}
          </Typography>
          <Box>
            {duplicate === null ? (
              <VideoStatusBadge status={video.status} analyzing={analyzing} variant="details" />
            ) : (
              <DuplicateBadge canonicalPath={duplicate.canonicalPath} />
            )}
          </Box>
        </Box>
      </Box>

      <MetadataCard video={video} />

      <TagRow tags={video.artifacts.summary?.tags ?? []} onTagSearch={onTagSearch} label={dictionary.details.videoTags} />

      {duplicate === null ? (
        <>
          <Typography variant="body2" color="text.secondary">
            {statusDescription(dictionary, video.status, analyzing)}
          </Typography>
          <StatusActions video={video} analyzing={analyzing} onAnalyze={onAnalyze} disabledReason={disabledReason} />
        </>
      ) : (
        <DuplicateDetail
          video={video}
          canonicalPath={duplicate.canonicalPath}
          analyzing={analyzing}
          onAnalyze={onAnalyze}
          onNavigateToCanonical={onNavigateToCanonical}
          disabledReason={disabledReason}
          dictionary={dictionary}
        />
      )}

      <ArtifactsSection video={video} />
    </Box>
  );
};

const TagRow = ({
  tags,
  onTagSearch,
  label,
}: {
  tags: readonly string[];
  onTagSearch?: ((tag: string) => void) | undefined;
  label: string;
}) =>
  tags.length === 0 ? null : (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }} aria-label={label}>
      {tags.map((tag) => (
        <Chip
          key={tag}
          label={tag}
          size="small"
          clickable={onTagSearch !== undefined}
          onClick={onTagSearch === undefined ? undefined : () => onTagSearch(tag)}
        />
      ))}
    </Box>
  );
