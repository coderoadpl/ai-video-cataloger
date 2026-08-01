import { Box, Chip, Dialog, DialogContent, DialogTitle, Link, Typography } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media-url.js';
import { OpenInNewIcon } from '../../components/ui/icons.js';
import type { PreviewMedia } from './core/index.js';

interface BrowsePreviewProps {
  item: PreviewMedia | null;
  onClose: () => void;
  onOpenInAnalysis: (folderPath: string, videoPath: string) => void;
}

const Row = ({ label, value }: { label: string; value: string | null }) => {
  if (value === null) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
};

export const BrowsePreview = ({ item, onClose, onOpenInAnalysis }: BrowsePreviewProps) => {
  const dictionary = useDictionary();

  return (
    <Dialog open={item !== null} onClose={onClose} maxWidth="md" fullWidth data-testid="browse-preview">
      {item === null ? null : (
        <>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h2" component="span" sx={{ flex: 1, minWidth: 0 }} noWrap title={item.title}>
              {item.title}
            </Typography>
            {item.online ? (
              <Link
                component="button"
                variant="body2"
                underline="hover"
                data-testid="preview-open-analysis"
                onClick={() => {
                  onOpenInAnalysis(item.folderPath, item.path);
                  onClose();
                }}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
              >
                <OpenInNewIcon fontSize="small" />
                {dictionary.preview.openInAnalysis}
              </Link>
            ) : (
              <Typography variant="body2" color="text.disabled" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <OpenInNewIcon fontSize="small" />
                {dictionary.preview.openInAnalysis}
              </Typography>
            )}
          </DialogTitle>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {item.online && !item.missing ? (
              <Box
                component="video"
                controls
                preload="metadata"
                src={mediaUrl(item.path)}
                {...(item.posterPath === null ? {} : { poster: mediaUrl(item.posterPath, item.fingerprint) })}
                data-testid="preview-player"
                sx={{ width: '100%', maxHeight: 420, objectFit: 'contain', bgcolor: 'common.black' }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary" data-testid="preview-unavailable">
                {item.online ? dictionary.preview.missing : dictionary.preview.offline}
              </Typography>
            )}
            <Row label={dictionary.photos.detailDescription} value={item.description} />
            {item.tags.length === 0 ? null : (
              <Box>
                <Typography variant="caption" color="text.secondary">{dictionary.photos.detailTags}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {item.tags.map((tag) => (
                    <Chip key={tag} label={tag} size="small" data-testid="preview-tag-chip" />
                  ))}
                </Box>
              </Box>
            )}
            <Row label={dictionary.map.place} value={item.placeName} />
            <Row label={dictionary.photos.detailCaptured} value={formatCapturedAt(item.capturedAt)} />
          </DialogContent>
        </>
      )}
    </Dialog>
  );
};
