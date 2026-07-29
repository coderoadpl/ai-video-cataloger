export const TAG_ALIAS_RULES = [
  'normalization',
  'pl-irregular',
  'en-plural',
  'pl-plural',
  'spelling-variant',
] as const;

export type TagAliasRule = (typeof TAG_ALIAS_RULES)[number];

export interface TagAliasProposal {
  from: string;
  to: string;
  fromCount: number;
  toCount: number;
  rule: TagAliasRule;
  canonicalLocked: boolean;
}

const PL_IRREGULAR_PAIRS: readonly (readonly [string, string])[] = [
  ['pies', 'psy'],
  ['pies', 'pieski'],
  ['psy', 'pieski'],
  ['dziecko', 'dzieci'],
  ['czlowiek', 'ludzie'],
  ['oko', 'oczy'],
  ['ucho', 'uszy'],
  ['reka', 'rece'],
  ['kon', 'konie'],
  ['dzien', 'dni'],
  ['tydzien', 'tygodnie'],
  ['miesiac', 'miesiace'],
  ['ksiadz', 'ksieza'],
];

const PL_PLURAL_SUFFIXES = ['y', 'i', 'e', 'ie'] as const;

const SPELLING_SUBSTITUTIONS: readonly (readonly [string, string])[] = [
  ['j', 'i'],
  ['w', 'v'],
  ['k', 'c'],
  ['s', 'z'],
  ['y', 'i'],
];

const foldKey = (tag: string): string =>
  tag
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const enPluralCandidates = (tag: string): string[] => {
  const candidates: string[] = [];
  if (tag.length >= 4 && !tag.endsWith('s')) candidates.push(`${tag}s`);
  if (/(?:[sxz]|ch|sh)$/.test(tag)) candidates.push(`${tag}es`);
  if (tag.endsWith('y') && tag.length >= 4) candidates.push(`${tag.slice(0, -1)}ies`);
  if (tag.endsWith('ies') && tag.length >= 6) candidates.push(`${tag.slice(0, -3)}y`);
  if (tag.endsWith('es') && tag.length >= 5) candidates.push(tag.slice(0, -2));
  if (tag.endsWith('s') && !tag.endsWith('ss') && tag.length >= 5) candidates.push(tag.slice(0, -1));
  return candidates;
};

const plPluralCandidates = (tag: string): string[] => {
  const candidates: string[] = [];
  for (const suffix of PL_PLURAL_SUFFIXES) {
    if (tag.length >= 4) candidates.push(`${tag}${suffix}`);
    if (tag.endsWith(suffix) && tag.length - suffix.length >= 4) {
      candidates.push(tag.slice(0, -suffix.length));
    }
  }
  return candidates;
};

const spellingVariantCandidates = (tag: string): string[] => {
  if (tag.length < 4) return [];
  const candidates: string[] = [];
  for (let index = 0; index < tag.length - 1; index += 1) {
    const character = tag[index];
    for (const [left, right] of SPELLING_SUBSTITUTIONS) {
      if (character === left) candidates.push(`${tag.slice(0, index)}${right}${tag.slice(index + 1)}`);
      else if (character === right) candidates.push(`${tag.slice(0, index)}${left}${tag.slice(index + 1)}`);
    }
  }
  return candidates;
};

const pairKey = (left: string, right: string): string => (left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`);

const collectPairs = (tagNames: ReadonlySet<string>): ReadonlyMap<TagAliasRule, ReadonlySet<string>> => {
  const pairsByRule = new Map<TagAliasRule, Set<string>>(TAG_ALIAS_RULES.map((rule) => [rule, new Set<string>()]));

  const addPair = (rule: TagAliasRule, left: string, right: string): void => {
    if (left === right) return;
    if (!tagNames.has(left) || !tagNames.has(right)) return;
    pairsByRule.get(rule)?.add(pairKey(left, right));
  };

  const foldGroups = new Map<string, string[]>();
  for (const name of tagNames) {
    const key = foldKey(name);
    const group = foldGroups.get(key) ?? [];
    group.push(name);
    foldGroups.set(key, group);
  }
  for (const group of foldGroups.values()) {
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        const a = group[left];
        const b = group[right];
        if (a !== undefined && b !== undefined) addPair('normalization', a, b);
      }
    }
  }

  for (const [left, right] of PL_IRREGULAR_PAIRS) addPair('pl-irregular', left, right);

  for (const name of tagNames) {
    for (const candidate of enPluralCandidates(name)) addPair('en-plural', name, candidate);
    for (const candidate of plPluralCandidates(name)) addPair('pl-plural', name, candidate);
    for (const candidate of spellingVariantCandidates(name)) addPair('spelling-variant', name, candidate);
  }

  return pairsByRule;
};

const resolveDirection = (
  left: string,
  right: string,
  rule: TagAliasRule,
  counts: ReadonlyMap<string, number>,
  aliasSet: ReadonlySet<string>,
  canonicalSet: ReadonlySet<string>,
): TagAliasProposal | null => {
  if (aliasSet.has(left) || aliasSet.has(right)) return null;
  const leftIsCanonical = canonicalSet.has(left);
  const rightIsCanonical = canonicalSet.has(right);
  if (leftIsCanonical && rightIsCanonical) return null;
  if (leftIsCanonical || rightIsCanonical) {
    const to = leftIsCanonical ? left : right;
    const from = leftIsCanonical ? right : left;
    return {
      from,
      to,
      fromCount: counts.get(from) ?? 0,
      toCount: counts.get(to) ?? 0,
      rule,
      canonicalLocked: true,
    };
  }
  const leftCount = counts.get(left) ?? 0;
  const rightCount = counts.get(right) ?? 0;
  const [from, to] = leftCount === rightCount
    ? (left.localeCompare(right) <= 0 ? [left, right] : [right, left])
    : (leftCount > rightCount ? [right, left] : [left, right]);
  return {
    from,
    to,
    fromCount: counts.get(from) ?? 0,
    toCount: counts.get(to) ?? 0,
    rule,
    canonicalLocked: false,
  };
};

const preferProposal = (candidate: TagAliasProposal, current: TagAliasProposal): boolean => {
  if (candidate.canonicalLocked !== current.canonicalLocked) return candidate.canonicalLocked;
  if (candidate.toCount !== current.toCount) return candidate.toCount > current.toCount;
  const rulePriority = TAG_ALIAS_RULES.indexOf(candidate.rule) - TAG_ALIAS_RULES.indexOf(current.rule);
  if (rulePriority !== 0) return rulePriority < 0;
  return candidate.to.localeCompare(current.to) < 0;
};

export const proposeTagAliases = (input: {
  tags: readonly { name: string; count: number }[];
  aliases: readonly { alias: string; canonical: string }[];
}): TagAliasProposal[] => {
  const tagNames = new Set(input.tags.map((tag) => tag.name));
  const counts = new Map(input.tags.map((tag) => [tag.name, tag.count]));
  const aliasSet = new Set(input.aliases.map((entry) => entry.alias));
  const canonicalSet = new Set(input.aliases.map((entry) => entry.canonical));

  const pairsByRule = collectPairs(tagNames);
  const seenPairs = new Set<string>();
  const proposalsByFrom = new Map<string, TagAliasProposal>();

  for (const rule of TAG_ALIAS_RULES) {
    for (const key of pairsByRule.get(rule) ?? []) {
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const [left, right] = key.split('\u0000');
      if (left === undefined || right === undefined) continue;
      const proposal = resolveDirection(left, right, rule, counts, aliasSet, canonicalSet);
      if (proposal === null) continue;
      const current = proposalsByFrom.get(proposal.from);
      if (current === undefined || preferProposal(proposal, current)) {
        proposalsByFrom.set(proposal.from, proposal);
      }
    }
  }

  return [...proposalsByFrom.values()].sort((left, right) => {
    const ruleDiff = TAG_ALIAS_RULES.indexOf(left.rule) - TAG_ALIAS_RULES.indexOf(right.rule);
    if (ruleDiff !== 0) return ruleDiff;
    const countDiff = (right.fromCount + right.toCount) - (left.fromCount + left.toCount);
    if (countDiff !== 0) return countDiff;
    return left.from.localeCompare(right.from);
  });
};
