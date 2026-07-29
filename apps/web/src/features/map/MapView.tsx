import { Alert, Box, CircularProgress, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { MapCanvas } from './MapCanvas.js';
import { useCatalogLocations } from './use-catalog-locations.js';

interface MapViewProps {
  active: boolean;
  focusFingerprint: string | null;
  onFocusConsumed: () => void;
  onOpenLocation: (folderPath: string, videoPath: string) => void;
}

export const MapView = ({ active, focusFingerprint, onFocusConsumed, onOpenLocation }: MapViewProps) => {
  const dictionary = useDictionary();
  const locations = useCatalogLocations({ enabled: active });

  if (!active) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%', p: 3, gap: 2, flex: 1 }}>
      <Box>
        <Typography variant="h1">{dictionary.map.title}</Typography>
        <Typography variant="caption">{dictionary.map.subtitle}</Typography>
      </Box>

      {locations.isLoading || locations.error !== null ? null : (
        <Typography variant="caption" data-testid="map-coverage">
          {dictionary.map.coverage(locations.locatedFiles, locations.totalFiles)}
        </Typography>
      )}

      {locations.isLoading ? (
        <Box
          sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}
          data-testid="map-loading"
        >
          <CircularProgress size={20} />
          <Typography variant="body2">{dictionary.map.loading}</Typography>
        </Box>
      ) : locations.error !== null ? (
        <Alert severity="error" data-testid="map-error">{locations.error}</Alert>
      ) : locations.locatedFiles === 0 ? (
        <Box
          sx={{
            flex: 1,
            minHeight: 260,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: 1,
            color: 'text.secondary',
          }}
          data-testid="map-empty-state"
        >
          <Typography variant="h2" color="text.primary">{dictionary.map.emptyTitle}</Typography>
          <Typography variant="body2" sx={{ maxWidth: 420 }}>{dictionary.map.emptyBody}</Typography>
        </Box>
      ) : (
        <MapCanvas
          locations={locations.locations}
          focusFingerprint={focusFingerprint}
          onFocusConsumed={onFocusConsumed}
          onOpenLocation={onOpenLocation}
        />
      )}
    </Box>
  );
};
