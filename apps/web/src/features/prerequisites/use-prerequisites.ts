import { useQuery } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { apiErrorMessage } from '../../i18n/api-error-message.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import type { DoctorResult, ReadinessResult } from './prerequisites-model.js';

export interface PrerequisitesState {
  isLoading: boolean;
  error: string | null;
  doctor: DoctorResult | null;
  readiness: ReadinessResult | null;
  check: () => void;
}

export const usePrerequisites = ({ open, folder }: { open: boolean; folder: string | null }): PrerequisitesState => {
  const dictionary = useDictionary();
  const doctorQuery = useQuery({ ...actions.doctor, enabled: open });
  const readinessQuery = useQuery({
    ...actions.readiness(folder === null ? { scope: 'home' } : { folder }),
    enabled: open,
  });
  const queryError = doctorQuery.error ?? readinessQuery.error;
  return {
    isLoading: open && (doctorQuery.isLoading || readinessQuery.isLoading),
    error: queryError === null ? null : apiErrorMessage(queryError, dictionary),
    doctor: doctorQuery.data ?? null,
    readiness: readinessQuery.data ?? null,
    check: () => {
      void doctorQuery.refetch();
      void readinessQuery.refetch();
    },
  };
};
