import { useCallback, type ReactNode } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Typography } from '@mui/material';

import { VariantCompareLayout } from '../../components/layout/VariantCompareLayout.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { type DetailsVideo } from './details-video.js';
import { FrameGallery } from './FrameGallery.js';
import { variantLabelModel, variantPreview, type VariantData } from './core/variant-model.js';
import { variantLabelText } from './variant-label.js';

export type VariantCompareVariant = VariantData;

interface VariantCompareViewProps {
  video: DetailsVideo;
  variants: readonly VariantData[];
  selectingConfigId: string | null;
  actionError: unknown;
  onBack: () => void;
  onSelect: (configId: string) => void;
  frameUrl?: (path: string) => string;
  dictionary: Dictionary;
}

const CompareSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    <Typography variant="h2">{title}</Typography>
    {children}
  </Box>
);

const VariantColumn = ({
  video,
  variant,
  selecting,
  onSelect,
  frameUrl,
  dictionary,
}: {
  video: DetailsVideo;
  variant: VariantData;
  selecting: boolean;
  onSelect: (configId: string) => void;
  frameUrl?: (path: string) => string;
  dictionary: Dictionary;
}) => {
  const preview = variantPreview(video, variant);
  const framePaths = preview.video.artifacts.framePaths ?? [];
  const descriptor = variant.descriptor;
  const select = useCallback(() => onSelect(variant.configId), [onSelect, variant.configId]);

  return (
    <Paper
      component="article"
      variant="outlined"
      data-testid={`variant-compare-column-${variant.configId}`}
      sx={{ p: 2, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="h2">
            {variantLabelText(variantLabelModel(variant), dictionary)}
          </Typography>
          {variant.selected ? <Chip size="small" label={dictionary.details.variants.selected} /> : null}
        </Box>
        <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
          {dictionary.details.variants.configurationId(variant.configId)}
        </Typography>
        {descriptor === null ? null : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            <Typography variant="caption">
              {dictionary.details.variants.outputLanguage(descriptor.output_language)}
            </Typography>
            <Typography variant="caption">
              {dictionary.details.variants.promptVersion(descriptor.promptVersion)}
            </Typography>
          </Box>
        )}
        {video.durationFormatted === null ? null : (
          <Typography variant="caption">
            {dictionary.details.variants.videoDuration(video.durationFormatted)}
          </Typography>
        )}
        {variant.estimatedCostUsd === null ? null : (
          <Typography variant="caption" data-testid={`variant-cost-${variant.configId}`}>
            {dictionary.details.variants.estimatedCost(variant.estimatedCostUsd)}
          </Typography>
        )}
      </Box>

      <Button
        variant={variant.selected ? 'outlined' : 'contained'}
        size="small"
        disabled={variant.selected || selecting}
        onClick={select}
        data-testid={`compare-use-as-selected-${variant.configId}`}
      >
        {selecting ? <CircularProgress size={14} color="inherit" /> : null}
        {dictionary.details.variants.useAsSelected}
      </Button>
      <Typography variant="caption">{dictionary.details.variants.selectionImpact}</Typography>

      <CompareSection title={dictionary.details.extractedFrames(framePaths.length)}>
        {framePaths.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {dictionary.details.variants.notRecorded}
          </Typography>
        ) : (
          <FrameGallery
            key={variant.configId}
            framePaths={framePaths}
            frameLabel={dictionary.details.frame}
            {...(frameUrl === undefined ? {} : { frameUrl })}
          />
        )}
      </CompareSection>

      <CompareSection title={dictionary.details.transcript}>
        {variant.transcript === null || variant.transcript.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {dictionary.details.variants.notRecorded}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
            {variant.transcript}
          </Typography>
        )}
      </CompareSection>

      <CompareSection title={dictionary.details.summary}>
        {variant.description === null || variant.description.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {dictionary.details.variants.notRecorded}
          </Typography>
        ) : (
          <Typography variant="body2">{variant.description}</Typography>
        )}
      </CompareSection>

      <CompareSection title={dictionary.details.videoTags}>
        {variant.tags.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {dictionary.details.variants.notRecorded}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {variant.tags.map((tag) => <Chip key={tag} size="small" label={tag} />)}
          </Box>
        )}
      </CompareSection>
    </Paper>
  );
};

export const VariantCompareView = ({
  video,
  variants,
  selectingConfigId,
  actionError,
  onBack,
  onSelect,
  frameUrl,
  dictionary,
}: VariantCompareViewProps) => {
  return (
    <VariantCompareLayout
      heading={
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="h1">{dictionary.details.variants.compareTitle}</Typography>
          <Typography variant="caption" noWrap title={video.path}>{video.filename}</Typography>
        </Box>
      }
      actions={
        <Button variant="outlined" size="small" onClick={onBack}>
          {dictionary.details.variants.backToDetails}
        </Button>
      }
      notice={actionError === null ? undefined : (
        <Alert severity="error">{dictionary.details.variants.actionError}</Alert>
      )}
      columns={variants.map((variant) => (
        <VariantColumn
          key={variant.configId}
          video={video}
          variant={variant}
          selecting={selectingConfigId === variant.configId}
          onSelect={onSelect}
          dictionary={dictionary}
          {...(frameUrl === undefined ? {} : { frameUrl })}
        />
      ))}
    />
  );
};
