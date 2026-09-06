export interface MergeCandidate {
  personId: string;
  displayName: string | null;
  observationCount: number;
}

export interface MergePlan<T extends MergeCandidate> {
  target: T;
  sources: T[];
}

export const mergeNameChoices = <T extends MergeCandidate>(selected: readonly T[]): T[] =>
  selected.filter((person) => person.displayName !== null);

export const defaultMergeTarget = <T extends MergeCandidate>(selected: readonly T[]): T | null => {
  if (selected.length < 2) return null;
  const named = mergeNameChoices(selected);
  const pool = named.length > 0 ? named : selected;
  return pool.reduce((best, person) => (person.observationCount > best.observationCount ? person : best));
};

export const mergePlanFor = <T extends MergeCandidate>(
  selected: readonly T[],
  targetPersonId: string,
): MergePlan<T> | null => {
  if (selected.length < 2) return null;
  const target = selected.find((person) => person.personId === targetPersonId);
  if (target === undefined) return null;
  return { target, sources: selected.filter((person) => person.personId !== targetPersonId) };
};
