import { Box, Button, Chip, Popover, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCoordinates } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media-url.js';
import type { CatalogLocation } from './use-catalog-locations.js';

interface MapPinPopoverProps {
  anchorEl: HTMLElement | null;
  location: CatalogLocation | null;
  onClose: () => void;
  onOpenPreview: (location: CatalogLocation) => void;
  onOpenPhoto: (fingerprint: string) => void;
}

export const MapPinPopover = ({ anchorEl, location, onClose, onOpenPreview, onOpenPhoto }: MapPinPopoverProps) => {
  const dictionary = useDictionary();

  return (
    <Popover
      open={anchorEl !== null && location !== null}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {location === null ? null : (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 220 }}>
          {location.media === 'photo' && location.thumbPath !== null && (
            <Box
              component="img"
              src={mediaUrl(location.thumbPath, location.fingerprint)}
              alt=""
              data-testid="map-pin-photo-thumb"
              sx={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 1 }}
            />
          )}
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={location.finalName ?? location.fileName}>
            {location.finalName ?? location.fileName}
          </Typography>
          <Typography variant="caption" noWrap title={location.folder.displayName}>
            {location.folder.displayName}
          </Typography>
          <Typography
            variant="caption"
            sx={{ fontFamily: 'ui-monospace, monospace' }}
            data-testid="map-pin-coordinates"
          >
            {formatCoordinates(location.lat, location.lon)}
          </Typography>
          {location.place !== null && (
            <Typography variant="caption" data-testid="map-pin-place">
              {[location.place.name, location.place.region, location.place.country].filter((value) => value !== null).join(' · ')}
            </Typography>
          )}
          {location.source !== null && (
            <Chip
              size="small"
              data-testid="map-pin-source-badge"
              label={location.source === 'camera'
                ? dictionary.map.source.camera
                : `${dictionary.map.source[location.source]}${location.accuracyM === null ? '' : ` ${dictionary.map.accuracy(Math.round(location.accuracyM))}`}`}
              sx={(theme) => ({
                alignSelf: 'flex-start',
                bgcolor: location.source === 'camera' ? theme.palette.status.completed.soft : theme.palette.map.pinApproximateHalo,
                color: location.source === 'camera' ? theme.palette.status.completed.main : theme.palette.map.pinApproximate,
              })}
            />
          )}
          {location.folder.online ? null : (
            <Chip
              size="small"
              label={dictionary.search.driveNotConnected}
              sx={(theme) => ({
                alignSelf: 'flex-start',
                bgcolor: theme.palette.status.notTracked.soft,
                color: theme.palette.status.notTracked.main,
              })}
            />
          )}
          {location.missing ? (
            <Chip
              size="small"
              label={dictionary.search.fileMissing}
              sx={(theme) => ({
                alignSelf: 'flex-start',
                bgcolor: theme.palette.status.notTracked.soft,
                color: theme.palette.status.notTracked.main,
              })}
            />
          ) : null}
          {location.media === 'photo' ? (
            <Button
              variant="contained"
              size="small"
              onClick={() => onOpenPhoto(location.fingerprint)}
              data-testid="map-open-photo"
            >
              {dictionary.map.openPhoto}
            </Button>
          ) : (
            <Button
              variant="contained"
              size="small"
              disabled={!location.folder.online}
              onClick={() => onOpenPreview(location)}
              data-testid="map-open-video"
            >
              {dictionary.map.openPreview}
            </Button>
          )}
        </Box>
      )}
    </Popover>
  );
};
