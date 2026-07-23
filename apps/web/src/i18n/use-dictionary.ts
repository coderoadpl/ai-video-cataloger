import { useQuery } from '@tanstack/react-query';

import { uiLanguageSchema } from '@core/domain/index.js';

import { actions } from '../api.js';
import { getDict, type Dictionary, type Locale } from './dictionary.js';

export const useUiLanguage = (): Locale => {
  const query = useQuery({ ...actions.config({}) });
  const data = query.data;
  if (data === undefined || !('effective' in data)) return 'en';
  const parsed = uiLanguageSchema.safeParse(data.effective.ui_language);
  return parsed.success ? parsed.data : 'en';
};

export const useDictionary = (): Dictionary => getDict(useUiLanguage());
