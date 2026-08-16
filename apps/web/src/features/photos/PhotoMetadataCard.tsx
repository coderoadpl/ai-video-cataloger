import { type ReactNode } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import type { CapturedAtSource } from '@core/domain/index.js';

import { ClockIcon, DescriptionIcon, FilmIcon, FolderIcon, ImageIcon, StorageIcon } from '../../components/ui/icons.js';
import type { Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import type { PhotoDetail } from './use-photos-analysis.js';

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

const Row = ({
  icon,
  label,
  value,
  testId,
  separator = true,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  testId?: string;
  separator?: boolean;
}) => {
  if (value === null) return null;
  return (
    <Box data-testid={testId} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
      {label === '' ? null : (
        <Typography variant="body2" color="text.secondary">
          {label}{separator ? ':' : ''}
        </Typography>
      )}
      <Typography variant="body2" noWrap sx={{ fontWeight: 500 }} title={value}>
        {value}
      </Typography>
    </Box>
  );
};

export const PhotoMetadataCard = ({ detail }: { detail: PhotoDetail }) => {
  const dictionary = useDictionary();
  const { photo, ownerPath, sightings } = detail;
  const capturedAt = formatCapturedAt(photo.capturedAt, dictionary.locale) ?? dictionary.photos.unknownDate;
  const capturedValue = photo.capturedAtSource === null
    ? capturedAt
    : `${capturedAt} (${capturedAtSourceLabel(dictionary, photo.capturedAtSource)})`;

  return (
    <Paper variant="outlined" data-testid="photo-metadata-card" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="h2">{dictionary.details.photoInformation}</Typography>
      <Row
        icon={<ImageIcon fontSize="small" />}
        label={dictionary.photos.detailDimensions}
        value={photo.width === null || photo.height === null ? null : `${String(photo.width)}×${String(photo.height)}`}
        testId="photo-metadata-row-dimensions"
      />
      <Row
        icon={<FilmIcon fontSize="small" />}
        label={dictionary.photos.detailCamera}
        value={[photo.cameraMake, photo.cameraModel].filter((part) => part !== null).join(' ') || null}
      />
      <Row icon={<DescriptionIcon fontSize="small" />} label={dictionary.photos.detailLens} value={photo.lens} />
      <Row
        icon={<ClockIcon fontSize="small" />}
        label={dictionary.photos.detailExposure}
        value={photo.exposureTime === null ? null : `${String(photo.exposureTime)}s`}
      />
      <Row icon={<StorageIcon fontSize="small" />} label={dictionary.photos.detailIso} value={photo.iso === null ? null : String(photo.iso)} />
      <Row
        icon={<DescriptionIcon fontSize="small" />}
        label={dictionary.photos.detailAperture}
        value={photo.fNumber === null ? null : `f/${String(photo.fNumber)}`}
      />
      <Row
        icon={<StorageIcon fontSize="small" />}
        label={dictionary.photos.detailRating}
        value={photo.exifRating === null ? null : String(photo.exifRating)}
      />
      <Row icon={<ClockIcon fontSize="small" />} label={dictionary.photos.detailCaptured} value={capturedValue} />
      <Row icon={<FolderIcon fontSize="small" />} label={dictionary.photos.detailOwnerPath} value={ownerPath} />
      {sightings.map((sighting, index) => (
        <Row
          key={sighting.currentPath}
          icon={<FolderIcon fontSize="small" />}
          label={index === 0 ? dictionary.photos.detailAlsoAt(sightings.length) : ''}
          value={sighting.currentPath}
          separator={false}
        />
      ))}
    </Paper>
  );
};
