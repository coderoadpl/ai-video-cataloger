import { type Dictionary } from '../../i18n/dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { analysisProvenanceLine, type AnalysisProvenance } from './core/index.js';
import { ANALYZER_PROVIDERS } from '@core/domain/index.js';

const configuredProviderNames: Record<string, string> = {};
for (const provider of ANALYZER_PROVIDERS) configuredProviderNames[provider.providerId] = provider.label;

export const analysisProvenanceText = (provenance: AnalysisProvenance, dictionary: Dictionary): string =>
  analysisProvenanceLine(
    provenance,
    {
      provider: {
        ...configuredProviderNames,
        local: dictionary.photos.provenanceProviderLocal,
        api: dictionary.photos.provenanceProviderApi,
        harness: dictionary.photos.provenanceProviderHarness,
      },
      language: {
        auto: dictionary.photos.provenanceLanguageAuto,
        en: dictionary.photos.provenanceLanguageEnglish,
        pl: dictionary.photos.provenanceLanguagePolish,
      },
    },
    (iso) => formatCapturedAt(iso, dictionary.locale),
  );
