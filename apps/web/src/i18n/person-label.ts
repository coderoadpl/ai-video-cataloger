import type { Dictionary } from './dictionary.js';

export interface LabelledPerson {
  displayName: string | null;
  fallbackIndex: number;
}

export const personLabel = (dictionary: Dictionary, person: LabelledPerson): string =>
  person.displayName ?? dictionary.people.personName(person.fallbackIndex);
