import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';

export const useReadiness = (folder: string | null) => {
  const queryClient = useQueryClient();
  const input = useMemo(() => folder === null ? {} : { folder }, [folder]);
  const query = useQuery(actions.readiness(input));
  const checkNow = useCallback(async (): Promise<boolean> => {
    try {
      const result = await queryClient.fetchQuery(actions.readiness({ ...input, refresh: 'true' }));
      return result.ready;
    } catch {
      return false;
    }
  }, [input, queryClient]);
  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    checkNow,
    refresh: query.refetch,
  };
};
