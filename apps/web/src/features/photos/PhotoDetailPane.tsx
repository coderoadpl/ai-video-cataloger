import { Box, CircularProgress, Divider, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import type { Dictionary } from '../../i18n/dictionary.js';
import type { CapturedAtSource } from '@core/domain/index.js';
import type { PhotoDetail } from './use-photos.js';

interface PhotoDetailPaneProps {
  detail: PhotoDetail | null;
  isLoading: boolean;
}

const capturedAtSourceLabel = (dictionary: Dictionary, source: CapturedAtSource): string => {
  switch (source) {
    case 'exif_offset':
      return dictionary.photos.capturedSourceExifOffset;
    case 'exif_gps_time':
      return dictionary.photos.capturedSourceExifGpsTime;
    case 'exif_local_assumed':
      return dictionary.photos.capturedSourceExifLocalAssumed;
    case 'file_mtime':
      return dictionary.photos.capturedSourceFileMtime;
  }
};

export const PhotoDetailPane = ({ detail, isLoading }: PhotoDetailPaneProps) => {
  const dictionary = useDictionary();

  if (isLoading) {
    return (
      <Box data-testid="photos-detail-loading" sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (detail === null) return null;

  const { photo, sightings, ownerPath } = detail;

  return (
    <Box data-testid="photos-detail" sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1 }}>
      <Typography variant="subtitle1" noWrap title={photo.fileName}>{photo.fileName}</Typography>
      <Row label={dictionary.photos.detailDimensions} value={photo.width === null || photo.height === null ? null : `${String(photo.width)}×${String(photo.height)}`} />
      <Row label={dictionary.photos.detailCamera} value={[photo.cameraMake, photo.cameraModel].filter((part) => part !== null).join(' ') || null} />
      <Row label={dictionary.photos.detailLens} value={photo.lens} />
      <Row label={dictionary.photos.detailIso} value={photo.iso === null ? null : String(photo.iso)} />
      <Row label={dictionary.photos.detailAperture} value={photo.fNumber === null ? null : `f/${String(photo.fNumber)}`} />
      <Row label={dictionary.photos.detailExposure} value={photo.exposureTime === null ? null : `${String(photo.exposureTime)}s`} />
      <Row label={dictionary.photos.detailRating} value={photo.exifRating === null ? null : String(photo.exifRating)} />
      <Box>
        <Typography variant="caption" color="text.secondary">{dictionary.photos.detailCaptured}</Typography>
        <Typography variant="body2">
          {photo.capturedAt ?? dictionary.photos.unknownDate}
          {photo.capturedAtSource === null ? '' : ` (${capturedAtSourceLabel(dictionary, photo.capturedAtSource)})`}
        </Typography>
      </Box>
      <Divider />
      <Row label={dictionary.photos.detailOwnerPath} value={ownerPath} />
      <Typography variant="caption" color="text.secondary">{dictionary.photos.detailAlsoAt(sightings.length)}</Typography>
      {sightings.map((sighting) => (
        <Typography key={sighting.currentPath} variant="caption" noWrap title={sighting.currentPath}>
          {sighting.currentPath}
        </Typography>
      ))}
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
