import { type Dictionary } from '../../i18n/dictionary.js';
import { formatCapturedAt } from '../../lib/format.js';
import { analysisProvenanceLine, type AnalysisProvenance } from './core/index.js';
import { ANALYZER_PROVIDERS } from '@core/domain/index.js';
import { humanizedVariantLanguage } from '../../components/ui/VariantControl.js';

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
        auto: humanizedVariantLanguage('auto', dictionary),
        en: humanizedVariantLanguage('en', dictionary),
        pl: humanizedVariantLanguage('pl', dictionary),
      },
    },
    (iso) => formatCapturedAt(iso, dictionary.locale),
  );
