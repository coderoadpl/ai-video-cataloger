import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';

import { EmptyState } from '../../components/ui/EmptyState.js';
import { MediaFilterToggle } from '../../components/ui/MediaFilterToggle.js';
import { PageHeader } from '../../components/ui/PageHeader.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatAnalyzerError } from '../../lib/analyzer-error-message.js';
import { MapCanvas } from './MapCanvas.js';
import { useCatalogLocations, type CatalogLocation } from './use-catalog-locations.js';

interface MapViewProps {
  active: boolean;
  focusFingerprint: string | null;
  onFocusConsumed: () => void;
  onOpenPreview: (location: CatalogLocation) => void;
  onOpenPhoto: (fingerprint: string) => void;
}

export const MapView = ({ active, focusFingerprint, onFocusConsumed, onOpenPreview, onOpenPhoto }: MapViewProps) => {
  const dictionary = useDictionary();
  const locations = useCatalogLocations({ enabled: active });

  if (!active) return null;

  const nothingLocated = locations.locatedFiles === 0 && locations.locatedPhotos === 0;
  const mediumEmpty = !nothingLocated && locations.filteredLocations.length === 0;
  const showChrome = !locations.isLoading && locations.error === null && !nothingLocated;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%', flex: 1 }}>
      <PageHeader
        testId="map-header"
        title={dictionary.map.title}
        subtitle={dictionary.map.subtitle}
        metrics={locations.isLoading || locations.error !== null ? undefined : (
          <>
            <Typography variant="caption" data-testid="map-coverage" component="div">
              {dictionary.map.coverage(locations.locatedFiles, locations.totalFiles)}
            </Typography>
            {locations.totalPhotos > 0 && (
              <Typography variant="caption" data-testid="map-coverage-photos" component="div">
                {dictionary.map.coveragePhotos(locations.locatedPhotos, locations.totalPhotos)}
              </Typography>
            )}
          </>
        )}
        actions={showChrome ? (
          <MediaFilterToggle
            value={locations.mediaFilter}
            counts={{
              all: locations.locatedFiles + locations.locatedPhotos,
              video: locations.locatedFiles,
              photo: locations.locatedPhotos,
            }}
            onChange={locations.setMediaFilter}
            groupTestId="map-media-filter"
            optionTestIdPrefix="map-media-filter"
            groupLabel={dictionary.map.mediaFilterLabel}
          />
        ) : undefined}
      />

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: 3, gap: 2 }}>
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
          <EmptyState
            testId="map-empty-state"
            title={dictionary.map.emptyTitle}
            body={dictionary.map.emptyBody}
          />
        ) : mediumEmpty ? (
          <EmptyState
            testId="map-media-empty-state"
            title={dictionary.map.mediaEmptyTitle}
            body={dictionary.map.mediaEmptyBody}
            action={(
              <Button
                variant="outlined"
                size="small"
                data-testid="map-media-empty-show-all"
                onClick={() => locations.setMediaFilter('all')}
              >
                {dictionary.library.showAllMedia}
              </Button>
            )}
          />
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
    </Box>
  );
};
