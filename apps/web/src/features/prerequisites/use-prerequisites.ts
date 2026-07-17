import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import type { DoctorResult, ReadinessResult } from './prerequisites-model.js';

export interface PrerequisitesState {
  isLoading: boolean;
  error: string | null;
  doctor: DoctorResult | null;
  readiness: ReadinessResult | null;
  check: () => void;
}

const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.appError.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const usePrerequisites = ({ open, folder }: { open: boolean; folder: string | null }): PrerequisitesState => {
  const doctorQuery = useQuery({ ...actions.doctor, enabled: open });
  const readinessQuery = useQuery({
    ...actions.readiness(folder === null ? {} : { folder }),
    enabled: open,
  });
  const queryError = doctorQuery.error ?? readinessQuery.error;
  return {
    isLoading: open && (doctorQuery.isLoading || readinessQuery.isLoading),
    error: queryError === null ? null : messageOf(queryError),
    doctor: doctorQuery.data ?? null,
    readiness: readinessQuery.data ?? null,
    check: () => {
      void doctorQuery.refetch();
      void readinessQuery.refetch();
    },
  };
};
