import { Box, Button, Chip, Popover, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCoordinates } from '../../lib/format.js';
import type { CatalogLocation } from './use-catalog-locations.js';

interface MapPinPopoverProps {
  anchorEl: HTMLElement | null;
  location: CatalogLocation | null;
  onClose: () => void;
  onOpenLocation: (folderPath: string, videoPath: string) => void;
}

export const MapPinPopover = ({ anchorEl, location, onClose, onOpenLocation }: MapPinPopoverProps) => {
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
          <Button
            variant="contained"
            size="small"
            disabled={!location.folder.online}
            onClick={() => onOpenLocation(location.folder.currentPath, `${location.folder.currentPath}/${location.fileName}`)}
            data-testid="map-open-video"
          >
            {dictionary.map.openVideo}
          </Button>
        </Box>
      )}
    </Popover>
  );
};
