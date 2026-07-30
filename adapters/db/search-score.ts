export const countTerm = (value: string, term: string): number => {
  const haystack = value.toLocaleLowerCase();
  const needle = term.toLocaleLowerCase();
  if (needle.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while (offset < haystack.length) {
    const index = haystack.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
  return count;
};
