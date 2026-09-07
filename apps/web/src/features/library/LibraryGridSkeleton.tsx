import { Box, Skeleton } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { LIBRARY_SECTION_HEADER_HEIGHT, LIBRARY_TILE_GAP, LIBRARY_TILE_SIZE } from '../../theme.js';

const SKELETON_TILES = 12;
const skeletonKeys = Array.from({ length: SKELETON_TILES }, (_, index) => `library-skeleton-${String(index)}`);

export const LibraryGridSkeleton = () => {
  const dictionary = useDictionary();

  return (
    <Box
      data-testid="library-loading"
      role="status"
      aria-label={dictionary.library.loadingLibrary}
      sx={{ flex: 1, minHeight: 0, overflow: 'hidden', px: 2, pt: 1 }}
    >
      <Box sx={{ height: LIBRARY_SECTION_HEADER_HEIGHT, display: 'flex', alignItems: 'center' }}>
        <Skeleton
          data-testid="library-section-header-skeleton"
          variant="text"
          animation="wave"
          sx={{ width: 160, bgcolor: 'library.tileBackground' }}
        />
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: `${String(LIBRARY_TILE_GAP)}px` }}>
        {skeletonKeys.map((key) => (
          <Skeleton
            key={key}
            data-testid="library-tile-skeleton"
            variant="rectangular"
            animation="wave"
            sx={{
              width: LIBRARY_TILE_SIZE,
              height: LIBRARY_TILE_SIZE,
              flexShrink: 0,
              borderRadius: 1,
              bgcolor: 'library.tileBackground',
            }}
          />
        ))}
      </Box>
    </Box>
  );
};
