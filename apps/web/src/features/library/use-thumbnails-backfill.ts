import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';

import { actions } from '../../api.js';

export interface UseThumbnailsBackfillTriggerInput {
  active: boolean;
  folders: readonly string[];
}

export const useThumbnailsBackfillTrigger = ({ active, folders }: UseThumbnailsBackfillTriggerInput): void => {
  const backfill = useMutation(actions.thumbnailsBackfill);
  const triggered = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!active) return;
    for (const folder of folders) {
      if (triggered.current.has(folder)) continue;
      triggered.current.add(folder);
      backfill.mutate({ root: folder, force: false });
    }
  }, [active, folders, backfill]);
};
