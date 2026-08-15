import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';

import { actions } from '../../api.js';

export interface UsePhotoThumbnailsBackfillTriggerInput {
  active: boolean;
  hasRoots: boolean;
}

export const usePhotoThumbnailsBackfillTrigger = ({ active, hasRoots }: UsePhotoThumbnailsBackfillTriggerInput): void => {
  const backfill = useMutation(actions.photosGridThumbs);
  const triggered = useRef(false);

  useEffect(() => {
    if (!active || !hasRoots || triggered.current) return;
    triggered.current = true;
    backfill.mutate({ force: false });
  }, [active, hasRoots, backfill]);
};
