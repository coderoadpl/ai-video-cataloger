import { useDictionary } from '../../i18n/use-dictionary.js';

export interface AutocompleteText {
  clearText: string;
  openText: string;
  closeText: string;
  noOptionsText: string;
}

export const useAutocompleteText = (): AutocompleteText => {
  const dictionary = useDictionary();
  return {
    clearText: dictionary.common.autocompleteClear,
    openText: dictionary.common.autocompleteOpen,
    closeText: dictionary.common.autocompleteClose,
    noOptionsText: dictionary.common.autocompleteNoOptions,
  };
};
