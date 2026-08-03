import { Box, Button, Chip, Paper, Typography } from '@mui/material';

import { CodeSnippetField } from '../../components/ui/CodeSnippetField.js';
import { DuplicateBadge } from '../../components/ui/DuplicateBadge.js';
import { ContentCopyIcon } from '../../components/ui/icons.js';
import { VideoStatusBadge } from '../../components/ui/VideoStatusBadge.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { ArtifactsSection } from './ArtifactsSection.js';
import { CardHeader } from '../../components/ui/CardHeader.js';
import { type DetailsVideo } from './details-video.js';
import { MetadataCard, type DetailsLocation } from './MetadataCard.js';
import { StatusActions } from './StatusActions.js';
import { statusDescription } from './status-info.js';
import { useVariants } from './use-variants.js';
import { VariantCompareView } from './VariantCompareView.js';
import { VariantSwitcher } from './VariantSwitcher.js';
import { VideoPlayer } from './VideoPlayer.js';

interface VideoDetailsProps {
  video: DetailsVideo;
  analyzing: boolean;
  onAnalyze?: ((video: DetailsVideo, options?: { force?: boolean }) => void) | undefined;
  onNavigateToCanonical?: ((canonicalPath: string) => void) | undefined;
  disabledReason?: string | undefined;
  onTagSearch?: ((tag: string) => void) | undefined;
  location?: DetailsLocation | null | undefined;
  onShowOnMap?: (() => void) | undefined;
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
  <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
    <CardHeader icon={<ContentCopyIcon fontSize="small" />} title={dictionary.details.duplicateTitle} />
    <Typography variant="body2">{dictionary.details.duplicateExplanation}</Typography>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography variant="caption" color="text.secondary">
        {dictionary.details.duplicateCanonicalLabel}
      </Typography>
      <CodeSnippetField value={canonicalPath} testId="duplicate-canonical-path" />
    </Box>
    {onAnalyze === undefined && onNavigateToCanonical === undefined ? null : (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {onAnalyze === undefined ? null : (
            <Button
              data-testid="analyze-anyway-button"
              variant="outlined"
              size="small"
              disabled={analyzing || disabledReason !== undefined}
              onClick={() => onAnalyze(video, { force: true })}
            >
              {analyzing ? dictionary.details.analyzingButton : dictionary.details.analyzeAnyway}
            </Button>
          )}
          {onNavigateToCanonical === undefined ? null : (
            <Button
              data-testid="duplicate-canonical-button"
              variant="outlined"
              size="small"
              onClick={() => onNavigateToCanonical(canonicalPath)}
            >
              {dictionary.details.navigateToOriginal}
            </Button>
          )}
        </Box>
        {onAnalyze === undefined || disabledReason === undefined ? null : (
          <Typography variant="caption">{disabledReason}</Typography>
        )}
      </Box>
    )}
  </Paper>
);

export const VideoDetails = ({
  video,
  analyzing,
  onAnalyze,
  onNavigateToCanonical,
  disabledReason,
  onTagSearch,
  location,
  onShowOnMap,
}: VideoDetailsProps) => {
  const dictionary = useDictionary();
  const duplicate = video.duplicate ?? null;
  const variants = useVariants(video);
  const previewVideo = variants.preview?.video ?? video;
  const previewTags = variants.preview?.tags ?? video.artifacts.summary?.tags ?? [];

  if (variants.comparing && variants.data !== null && variants.data.variants.length >= 2) {
    return (
      <VariantCompareView
        video={video}
        variants={variants.data.variants}
        selectingConfigId={variants.selectingConfigId}
        actionError={variants.actionError}
        onBack={variants.hideComparison}
        onSelect={variants.useAsSelected}
        dictionary={dictionary}
      />
    );
  }

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, maxWidth: { xs: 780, lg: 1180 } }}>
      <Box
        data-testid="detail-layout"
        data-video-status={video.status}
        sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 3, alignItems: 'flex-start' }}
      >
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography variant="h1" noWrap title={video.filename}>
              {video.filename}
            </Typography>
            <Typography variant="caption" noWrap title={video.path}>
              {video.path}
            </Typography>
            <Box>
              {duplicate === null || analyzing ? (
                <VideoStatusBadge status={video.status} analyzing={analyzing} variant="details" />
              ) : (
                <DuplicateBadge canonicalPath={duplicate.canonicalPath} />
              )}
            </Box>
          </Box>

          <MetadataCard video={video} location={location} onShowOnMap={onShowOnMap} />

          <VariantSwitcher state={variants} />

          <TagRow tags={previewTags} onTagSearch={onTagSearch} label={dictionary.details.videoTags} />

          {duplicate === null ? (
            <>
              {video.status === 'error' && !analyzing ? null : (
                <Typography variant="body2" color="text.secondary">
                  {statusDescription(dictionary, video.status, analyzing, video.artifacts)}
                </Typography>
              )}
              <StatusActions
                video={video}
                analyzing={analyzing}
                onAnalyze={onAnalyze}
                disabledReason={disabledReason}
                analysisPlan={variants.plan}
                variantCount={variants.data?.variants.length ?? 0}
              />
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
        </Box>

        <Box sx={{ width: { xs: '100%', lg: 440 }, flexShrink: 0, order: { xs: -1, lg: 0 } }}>
          <VideoPlayer video={video} />
        </Box>
      </Box>

      <ArtifactsSection video={previewVideo} />
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
