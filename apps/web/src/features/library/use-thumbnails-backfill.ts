import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';

import { actions } from '../../api.js';

export interface UseThumbnailsBackfillTriggerInput {
  active: boolean;
  folder: string | null;
}

export const useThumbnailsBackfillTrigger = ({ active, folder }: UseThumbnailsBackfillTriggerInput): void => {
  const backfill = useMutation(actions.thumbnailsBackfill);
  const triggered = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!active || folder === null || triggered.current.has(folder)) return;
    triggered.current.add(folder);
    backfill.mutate({ root: folder, force: false });
  }, [active, folder, backfill]);
};
