import { Alert, Box, Chip, CircularProgress, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import { MapCanvas } from './MapCanvas.js';
import { MAP_MEDIA_FILTERS, type MapMediaFilter } from './core/index.js';
import { useCatalogLocations, type CatalogLocation } from './use-catalog-locations.js';

interface MapViewProps {
  active: boolean;
  focusFingerprint: string | null;
  onFocusConsumed: () => void;
  onOpenPreview: (location: CatalogLocation) => void;
  onOpenPhoto: (fingerprint: string) => void;
}

const filterLabel = (dictionary: ReturnType<typeof useDictionary>, filter: MapMediaFilter): string => {
  if (filter === 'video') return dictionary.map.filter.videos;
  if (filter === 'photo') return dictionary.map.filter.photos;
  return dictionary.map.filter.all;
};

export const MapView = ({ active, focusFingerprint, onFocusConsumed, onOpenPreview, onOpenPhoto }: MapViewProps) => {
  const dictionary = useDictionary();
  const locations = useCatalogLocations({ enabled: active });

  if (!active) return null;

  const nothingLocated = locations.locatedFiles === 0 && locations.locatedPhotos === 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%', p: 3, gap: 2, flex: 1 }}>
      <Box>
        <Typography variant="h1">{dictionary.map.title}</Typography>
        <Typography variant="caption">{dictionary.map.subtitle}</Typography>
      </Box>

      {locations.isLoading || locations.error !== null ? null : (
        <Box>
          <Typography variant="caption" data-testid="map-coverage" component="div">
            {dictionary.map.coverage(locations.locatedFiles, locations.totalFiles)}
          </Typography>
          {locations.totalPhotos > 0 && (
            <Typography variant="caption" data-testid="map-coverage-photos" component="div">
              {dictionary.map.coveragePhotos(locations.locatedPhotos, locations.totalPhotos)}
            </Typography>
          )}
        </Box>
      )}

      {locations.isLoading || locations.error !== null || nothingLocated ? null : (
        <Box sx={{ display: 'flex', gap: 1 }} data-testid="map-media-filter">
          {MAP_MEDIA_FILTERS.map((filter) => (
            <Chip
              key={filter}
              size="small"
              data-testid={`map-media-filter-${filter}`}
              label={filterLabel(dictionary, filter)}
              color={locations.mediaFilter === filter ? 'primary' : 'default'}
              onClick={() => locations.setMediaFilter(filter)}
            />
          ))}
        </Box>
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
        <Alert severity="error" data-testid="map-error">{formatAnalyzerError(locations.error, dictionary.errors)}</Alert>
      ) : nothingLocated ? (
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
          locations={locations.filteredLocations}
          focusFingerprint={focusFingerprint}
          onFocusConsumed={onFocusConsumed}
          onOpenPreview={onOpenPreview}
          onOpenPhoto={onOpenPhoto}
        />
      )}
    </Box>
  );
};
