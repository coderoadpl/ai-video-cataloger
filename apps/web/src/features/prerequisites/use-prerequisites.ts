import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import type { DoctorResult } from './prerequisites-model.js';

export interface PrerequisitesState {
  isLoading: boolean;
  error: string | null;
  result: DoctorResult | null;
  check: () => void;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const usePrerequisites = ({ open }: { open: boolean }): PrerequisitesState => {
  const query = useQuery({ ...actions.doctor, enabled: open });
  return {
    isLoading: open && query.isLoading,
    error: query.error === null ? null : messageOf(query.error),
    result: query.data ?? null,
    check: () => void query.refetch(),
  };
};
