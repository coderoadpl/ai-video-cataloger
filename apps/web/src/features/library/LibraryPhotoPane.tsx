import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Chip, CircularProgress, Typography } from '@mui/material';

import { actions } from '../../api.js';
import type { Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { mediaUrl } from '../../lib/media-url.js';
import { photoViewerSourceCandidates, type LibraryPhotoItem } from './core/index.js';
import { ViewerDetailRow } from './ViewerDetailRow.js';

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

export const LibraryPhotoStage = ({ item }: { item: LibraryPhotoItem }) => {
  const dictionary = useDictionary();
  const detail = useQuery(actions.photosDetail({ fingerprint: item.fingerprint }));
  const candidates = photoViewerSourceCandidates(item, detail.data?.proxyPath ?? item.proxyPath);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setAttempt(0), [item.fingerprint]);

  const source = candidates[attempt] ?? null;
  if (source === null) return <Typography>{dictionary.photos.noProxyYet}</Typography>;

  return (
    <Box
      component="img"
      alt={item.fileName}
      src={mediaUrl(source, item.fingerprint)}
      onError={() => setAttempt((current) => current + 1)}
      data-testid="library-media-viewer-image"
      sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
    />
  );
};

export const LibraryPhotoDetails = ({ item }: { item: LibraryPhotoItem }) => {
  const dictionary = useDictionary();
  const detail = useQuery(actions.photosDetail({ fingerprint: item.fingerprint }));
  const analysis = detail.data?.analysis ?? null;

  if (detail.isLoading) return <CircularProgress size={20} />;
  if (analysis === null) {
    return <Typography variant="body2" color="text.secondary">{dictionary.photos.analysisNone}</Typography>;
  }

  return (
    <>
      <ViewerDetailRow
        label={dictionary.photos.detailDescription}
        value={analysis.description}
        testId="library-media-viewer-description"
      />
      <ViewerDetailRow label={dictionary.photos.detailScene} value={sceneLabel(dictionary, analysis.scene)} />
      <ViewerDetailRow label={dictionary.photos.detailQuality} value={qualityLabel(dictionary, analysis.quality)} />
      {analysis.tags.length === 0 ? null : (
        <Box data-testid="library-media-viewer-tags">
          <Typography variant="caption" color="text.secondary">{dictionary.photos.detailTags}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            {analysis.tags.map((tag) => <Chip key={tag} label={tag} size="small" />)}
          </Box>
        </Box>
      )}
      <ViewerDetailRow
        label={dictionary.photos.detailCaptured}
        value={formatCapturedAt(item.capturedAt, dictionary.locale)}
      />
      <ViewerDetailRow label={dictionary.photos.detailVariant} value={provenanceText(dictionary, analysis)} />
    </>
  );
};
