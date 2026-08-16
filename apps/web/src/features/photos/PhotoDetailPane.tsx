import { Box, Button, Chip, CircularProgress, MenuItem, Paper, Select, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { CardHeader } from '../../components/ui/CardHeader.js';
import { DetailStatusCard } from '../../components/ui/DetailStatusCard.js';
import { VariantControl } from '../../components/ui/VariantControl.js';
import { ClockIcon, DescriptionIcon, ErrorIcon } from '../../components/ui/icons.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import type { Dictionary } from '../../i18n/dictionary.js';
import type { PHOTO_QUALITIES, PHOTO_SCENES } from '@core/domain/index.js';
import { analysisProvenanceText } from './analysis-provenance.js';
import { PhotoMetadataCard } from './PhotoMetadataCard.js';
import { PhotoStatusBadge, type PhotoStatus } from './PhotoStatusBadge.js';
import type { PhotoDetail, PhotoVariantRecord } from './use-photos-analysis.js';

interface PhotoDetailPaneProps {
  detail: PhotoDetail | null;
  isLoading: boolean;
  variants: PhotoVariantRecord[];
  onSelectVariant: (configId: string | null) => void;
  onAnalyze: () => void;
  onSearchTag?: ((tag: string) => void) | undefined;
  isBusy: boolean;
  canAnalyze: boolean;
  analyzeProgress: { current: number; total: number } | null;
}

type PhotosDictStringKey = { [K in keyof Dictionary['photos']]: Dictionary['photos'][K] extends string ? K : never }[keyof Dictionary['photos']];

const SCENE_LABEL_KEYS: Record<(typeof PHOTO_SCENES)[number], PhotosDictStringKey> = {
  people: 'scenePeople',
  landscape: 'sceneLandscape',
  urban: 'sceneUrban',
  indoor: 'sceneIndoor',
  food: 'sceneFood',
  document: 'sceneDocument',
  screenshot: 'sceneScreenshot',
  animal: 'sceneAnimal',
  vehicle: 'sceneVehicle',
  event: 'sceneEvent',
  object: 'sceneObject',
  other: 'sceneOther',
};

const QUALITY_LABEL_KEYS: Record<(typeof PHOTO_QUALITIES)[number], PhotosDictStringKey> = {
  good: 'qualityGood',
  blurry: 'qualityBlurry',
  dark: 'qualityDark',
  overexposed: 'qualityOverexposed',
  other: 'qualityOther',
};

const isPhotoScene = (value: string): value is keyof typeof SCENE_LABEL_KEYS =>
  Object.hasOwn(SCENE_LABEL_KEYS, value);

const isPhotoQuality = (value: string): value is keyof typeof QUALITY_LABEL_KEYS =>
  Object.hasOwn(QUALITY_LABEL_KEYS, value);

const sceneLabel = (dictionary: Dictionary, scene: string): string =>
  isPhotoScene(scene) ? dictionary.photos[SCENE_LABEL_KEYS[scene]] : scene;

const qualityLabel = (dictionary: Dictionary, quality: string): string =>
  isPhotoQuality(quality) ? dictionary.photos[QUALITY_LABEL_KEYS[quality]] : quality;

export const PhotoDetailPane = ({
  detail,
  isLoading,
  variants,
  onSelectVariant,
  onAnalyze,
  onSearchTag,
  isBusy,
  canAnalyze,
  analyzeProgress,
}: PhotoDetailPaneProps) => {
  const dictionary = useDictionary();

  if (isLoading) {
    return (
      <Box data-testid="photos-detail-loading" sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (detail === null) return null;

  const { photo, sightings, analysis, analysisError } = detail;
  const statuses: PhotoStatus[] = analysis === null ? [] : ['analysed'];
  if (analysisError !== null) statuses.push('analysisFailed');
  if (analysis === null && analysisError === null) statuses.push('pending');
  if (sightings.length > 1) statuses.push('duplicate');

  return (
    <Box data-testid="photos-detail" sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box data-testid="photos-detail-header" sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography variant="h1" noWrap title={photo.fileName}>{photo.fileName}</Typography>
        <Typography variant="caption" noWrap title={photo.currentPath}>{photo.currentPath}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {statuses.map((status) => (
            <PhotoStatusBadge
              key={status}
              status={status}
              dictionary={dictionary}
              testId={`photos-detail-badge-${status}`}
            />
          ))}
        </Box>
      </Box>
      <PhotoMetadataCard detail={detail} />
      {analysisError === null ? null : (
        <DetailStatusCard
          testId="photo-analysis-error-card"
          icon={<ErrorIcon fontSize="small" />}
          title={dictionary.photos.analysisFailedTitle}
          token="error"
          body={<Typography variant="body2">{formatAnalyzerError(analysisError.message, dictionary.errors)}</Typography>}
          action={(
            <Button
              variant="outlined"
              size="small"
              onClick={onAnalyze}
              disabled={isBusy || !canAnalyze}
              title={canAnalyze ? undefined : dictionary.photos.analyzeUnavailable}
              data-testid="photos-analyze-action"
            >
              {dictionary.photos.analyzeAgainAction}
            </Button>
          )}
        />
      )}
      {analysis === null && analysisError === null ? (
        photo.proxyState === 'done' ? (
          <DetailStatusCard
            testId="photos-analyze-strip"
            icon={<ClockIcon fontSize="small" />}
            title={
              analyzeProgress !== null
                ? dictionary.photos.analyzeProgress(analyzeProgress.current, analyzeProgress.total)
                : canAnalyze
                  ? dictionary.photos.analysisNone
                  : dictionary.photos.analyzeUnavailable
            }
            token="notTracked"
            action={(
              <Button
                variant="contained"
                size="small"
                onClick={onAnalyze}
                disabled={isBusy || !canAnalyze}
                title={canAnalyze ? undefined : dictionary.photos.analyzeUnavailable}
                data-testid="photos-analyze-action"
              >
                {dictionary.photos.analyzeAction}
              </Button>
            )}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">{dictionary.photos.analysisNone}</Typography>
        )
      ) : analysis === null ? null : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Paper
            variant="outlined"
            data-testid="photo-description-card"
            sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}
          >
            <CardHeader icon={<DescriptionIcon fontSize="small" />} title={dictionary.photos.detailDescription} />
            {analysis.description.length === 0 ? null : (
              <Typography variant="body2">{analysis.description}</Typography>
            )}
            <Row label={dictionary.photos.detailScene} value={sceneLabel(dictionary, analysis.scene)} />
            <Row label={dictionary.photos.detailQuality} value={qualityLabel(dictionary, analysis.quality)} />
          </Paper>
          <Box>
            <Typography variant="caption" color="text.secondary">{dictionary.photos.detailTags}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {analysis.tags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  size="small"
                  clickable={onSearchTag !== undefined}
                  onClick={onSearchTag === undefined ? undefined : () => onSearchTag(tag)}
                  data-testid="photo-tag-chip"
                />
              ))}
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary">{dictionary.photos.variantPickerLabel}</Typography>
          <VariantControl
            testId="photo-variant-control"
            captionTestId="photo-variant-caption"
            control={(
              <Select
                size="small"
                value={analysis.explicit ? analysis.configId : ''}
                displayEmpty
                aria-label={dictionary.photos.variantPickerLabel}
                data-testid="photo-variant-picker"
                onChange={(event) => onSelectVariant(event.target.value === '' ? null : event.target.value)}
              >
                <MenuItem value="">{dictionary.photos.variantAutomatic}</MenuItem>
                {variants.map((variantOption) => (
                  <MenuItem key={variantOption.configId} value={variantOption.configId}>{variantOption.label}</MenuItem>
                ))}
              </Select>
            )}
            caption={analysisProvenanceText(analysis, dictionary)}
          />
        </Box>
      )}
    </Box>
  );
};

const Row = ({ label, value }: { label: string; value: string | null }) => {
  if (value === null) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
};
