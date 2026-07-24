import { useDictionary } from '../../i18n/use-dictionary.js';
import type { useReadiness } from './use-readiness.js';

type ReadinessState = ReturnType<typeof useReadiness>;

export const useAnalysisDisabledReason = (
  lockReason: string | undefined,
  readiness: ReadinessState,
): string | undefined => {
  const dictionary = useDictionary();
  if (lockReason !== undefined) return lockReason;
  if (readiness.data !== null && !readiness.data.ready) {
    return dictionary.readinessNotice.missing(readiness.data.missingPieces.map((piece) => piece.name).join(', '));
  }
  if (readiness.isLoading) return dictionary.wizard.readiness.checking;
  return undefined;
};
