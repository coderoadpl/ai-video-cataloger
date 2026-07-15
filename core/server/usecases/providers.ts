import {
  ANALYZER_PROVIDERS,
  ok,
  type AnalyzerProviderConfig,
  type AnalyzerProviderDescriptor,
  type AppError,
  type Result,
} from '@core/domain/index.js';

import type { ProvidersPort, ProviderTestResult } from '../ports.js';

export const listProviders = (): Result<{ providers: readonly AnalyzerProviderDescriptor[] }, AppError> =>
  ok({ providers: ANALYZER_PROVIDERS });

export const testProvider = (
  deps: { providers: ProvidersPort },
  input: AnalyzerProviderConfig,
): Promise<Result<ProviderTestResult, AppError>> => deps.providers.test(input);
