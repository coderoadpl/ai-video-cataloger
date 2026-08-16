import { Box, Button, Chip, CircularProgress, MenuItem, Paper, Select, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { CardHeader } from '../../components/ui/CardHeader.js';
import { ClockIcon } from '../../components/ui/icons.js';
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

  const { photo, sightings, analysis } = detail;
  const statuses: PhotoStatus[] = [analysis === null ? 'pending' : 'analysed'];
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
      {analysis === null ? (
        photo.proxyState === 'done' ? (
          <Paper
            variant="outlined"
            data-testid="photos-analyze-strip"
            sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            <CardHeader
              icon={<ClockIcon fontSize="small" sx={{ color: 'status.notTracked.main' }} />}
              title={
                analyzeProgress !== null
                  ? dictionary.photos.analyzeProgress(analyzeProgress.current, analyzeProgress.total)
                  : canAnalyze
                    ? dictionary.photos.analysisNone
                    : dictionary.photos.analyzeUnavailable
              }
            />
            <Box>
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
            </Box>
          </Paper>
        ) : (
          <Typography variant="body2" color="text.secondary">{dictionary.photos.analysisNone}</Typography>
        )
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Row label={dictionary.photos.detailDescription} value={analysis.description || null} />
          <Row label={dictionary.photos.detailScene} value={sceneLabel(dictionary, analysis.scene)} />
          <Row label={dictionary.photos.detailQuality} value={qualityLabel(dictionary, analysis.quality)} />
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
          <Row label={dictionary.photos.detailVariant} value={analysisProvenanceText(analysis, dictionary)} />
          <Typography variant="caption" color="text.secondary">{dictionary.photos.variantPickerLabel}</Typography>
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
