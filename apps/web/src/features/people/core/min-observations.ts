export const PEOPLE_MIN_OBSERVATION_OPTIONS = [1, 2, 3, 5, 10, 20, 50] as const;

export type PeopleMinObservations = (typeof PEOPLE_MIN_OBSERVATION_OPTIONS)[number];

export const PEOPLE_MIN_OBSERVATIONS_DEFAULT: PeopleMinObservations = 10;

export const isPeopleMinObservations = (value: number): value is PeopleMinObservations =>
  PEOPLE_MIN_OBSERVATION_OPTIONS.some((option) => option === value);

export const peopleMinObservationIndex = (value: PeopleMinObservations): number =>
  PEOPLE_MIN_OBSERVATION_OPTIONS.indexOf(value);

export const peopleMinObservationAtIndex = (index: number): PeopleMinObservations | null =>
  PEOPLE_MIN_OBSERVATION_OPTIONS[index] ?? null;

export const peopleMinObservationMarks: readonly { value: number; label: string }[] =
  PEOPLE_MIN_OBSERVATION_OPTIONS.map((value, index) => ({ value: index, label: String(value) }));
