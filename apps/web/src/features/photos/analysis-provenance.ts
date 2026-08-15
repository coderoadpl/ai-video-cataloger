import { type Dictionary } from '../../i18n/dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { analysisProvenanceLine, type AnalysisProvenance } from './core/index.js';

export const analysisProvenanceText = (provenance: AnalysisProvenance, dictionary: Dictionary): string =>
  analysisProvenanceLine(
    provenance,
    {
      provider: {
        local: dictionary.photos.provenanceProviderLocal,
        api: dictionary.photos.provenanceProviderApi,
        harness: dictionary.photos.provenanceProviderHarness,
      },
      language: { auto: dictionary.photos.provenanceLanguageAuto },
    },
    (iso) => formatCapturedAt(iso, dictionary.locale),
  );
