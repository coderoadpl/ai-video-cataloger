import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, Chip, CircularProgress, IconButton, Modal, Typography } from '@mui/material';

import { actions } from '../../api.js';
import { ArrowBackIcon, CancelIcon, SkipNextIcon } from '../../components/ui/icons.js';
import type { Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media-url.js';
import { photoViewerSourceCandidates, type LibraryPhotoItem } from './core/index.js';

interface LibraryPhotoViewerProps {
  item: LibraryPhotoItem;
  onClose: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  onOpenInAnalysis: () => void;
}

const sceneLabel = (dictionary: Dictionary, scene: string): string => ({
  people: dictionary.photos.scenePeople,
  landscape: dictionary.photos.sceneLandscape,
  urban: dictionary.photos.sceneUrban,
  indoor: dictionary.photos.sceneIndoor,
  food: dictionary.photos.sceneFood,
  document: dictionary.photos.sceneDocument,
  screenshot: dictionary.photos.sceneScreenshot,
  animal: dictionary.photos.sceneAnimal,
  vehicle: dictionary.photos.sceneVehicle,
  event: dictionary.photos.sceneEvent,
  object: dictionary.photos.sceneObject,
  other: dictionary.photos.sceneOther,
})[scene] ?? scene;

const qualityLabel = (dictionary: Dictionary, quality: string): string => ({
  good: dictionary.photos.qualityGood,
  blurry: dictionary.photos.qualityBlurry,
  dark: dictionary.photos.qualityDark,
  overexposed: dictionary.photos.qualityOverexposed,
  other: dictionary.photos.qualityOther,
})[quality] ?? quality;

const provenanceText = (
  dictionary: Dictionary,
  provenance: { label: string; createdAt: string },
): string => {
  const segments = provenance.label.split(' · ');
  const provider = segments[0];
  const model = segments[1];
  const language = segments[2];
  const providerLabels: Readonly<Record<string, string>> = {
    local: dictionary.photos.provenanceProviderLocal,
    api: dictionary.photos.provenanceProviderApi,
    harness: dictionary.photos.provenanceProviderHarness,
  };
  const label = segments.length === 3 && provider !== undefined && model !== undefined && language !== undefined
    ? [providerLabels[provider] ?? provider, model, language === 'auto' ? dictionary.photos.provenanceLanguageAuto : language].join(' · ')
    : provenance.label;
  const timestamp = formatCapturedAt(provenance.createdAt, dictionary.locale);
  return timestamp === null ? label : `${label} · ${timestamp}`;
};

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="body2">{value}</Typography>
  </Box>
);

export const LibraryPhotoViewer = ({
  item,
  onClose,
  onPrevious,
  onNext,
  onOpenInAnalysis,
}: LibraryPhotoViewerProps) => {
  const dictionary = useDictionary();
  const detail = useQuery(actions.photosDetail({ fingerprint: item.fingerprint }));
  const candidates = photoViewerSourceCandidates(item, detail.data?.proxyPath ?? item.proxyPath);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setAttempt(0), [item.fingerprint]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && onPrevious !== null) onPrevious();
      if (event.key === 'ArrowRight' && onNext !== null) onNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onNext, onPrevious]);

  const source = candidates[attempt] ?? null;
  const analysis = detail.data?.analysis ?? null;

  return (
    <Modal open onClose={onClose} data-testid="photos-viewer">
      <Box
        sx={{
          position: 'absolute',
          top: '5%',
          left: '5%',
          right: '5%',
          bottom: '5%',
          bgcolor: 'background.paper',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1 }}>
          <Button variant="outlined" size="small" onClick={onOpenInAnalysis} data-testid="library-photo-viewer-open-analysis">
            {dictionary.library.openInAnalysis}
          </Button>
          <IconButton aria-label={dictionary.photos.viewerClose} onClick={onClose} data-testid="photos-viewer-close">
            <CancelIcon />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', p: 2 }}>
            {onPrevious !== null ? (
              <IconButton
                aria-label={dictionary.photos.viewerPrevious}
                onClick={onPrevious}
                data-testid="photos-viewer-previous"
                sx={{ position: 'absolute', left: 8 }}
              >
                <ArrowBackIcon />
              </IconButton>
            ) : null}
            {source === null ? (
              <Typography>{dictionary.photos.noProxyYet}</Typography>
            ) : (
              <Box
                component="img"
                alt={item.fileName}
                src={mediaUrl(source, item.fingerprint)}
                onError={() => setAttempt((current) => current + 1)}
                sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            )}
            {onNext !== null ? (
              <IconButton
                aria-label={dictionary.photos.viewerNext}
                onClick={onNext}
                data-testid="photos-viewer-next"
                sx={{ position: 'absolute', right: 8 }}
              >
                <SkipNextIcon />
              </IconButton>
            ) : null}
          </Box>
          <Box
            data-testid="library-photo-viewer-details"
            sx={{ width: 340, maxWidth: '38%', borderLeft: 1, borderColor: 'divider', p: 2, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <Typography variant="h2">{item.fileName}</Typography>
            {detail.isLoading ? <CircularProgress size={20} /> : analysis === null ? (
              <Typography variant="body2" color="text.secondary">{dictionary.photos.analysisNone}</Typography>
            ) : (
              <>
                <DetailRow label={dictionary.photos.detailDescription} value={analysis.description} />
                <DetailRow label={dictionary.photos.detailScene} value={sceneLabel(dictionary, analysis.scene)} />
                <DetailRow label={dictionary.photos.detailQuality} value={qualityLabel(dictionary, analysis.quality)} />
                <Box>
                  <Typography variant="caption" color="text.secondary">{dictionary.photos.detailTags}</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {analysis.tags.map((tag) => <Chip key={tag} label={tag} size="small" />)}
                  </Box>
                </Box>
                <DetailRow label={dictionary.photos.detailVariant} value={provenanceText(dictionary, analysis)} />
              </>
            )}
          </Box>
        </Box>
        <Box sx={{ p: 1, textAlign: 'center' }}>
          <Typography variant="body2">
            {item.fileName}
            {item.capturedAt === null ? '' : ` · ${formatCapturedAt(item.capturedAt, dictionary.locale) ?? ''}`}
          </Typography>
        </Box>
      </Box>
    </Modal>
  );
};
