import { appError, normalizeTagName, ok, proposeTagAliases, type AppError, type Result, type TagAliasProposal } from '@core/domain/index.js';

import type { CatalogTagAliasResult, CatalogTagSummary, GlobalCatalogStore } from '../ports.js';

export interface TagsDeps {
  globalCatalog: GlobalCatalogStore;
}

export interface TagsListOutput {
  tags: CatalogTagSummary[];
}

export type TagsAliasOutput = CatalogTagAliasResult;

export interface TagsSuggestAliasesOutput {
  proposals: TagAliasProposal[];
}

export const listTags = async (deps: TagsDeps): Promise<Result<TagsListOutput, AppError>> => {
  const tags = await deps.globalCatalog.listTags();
  if (!tags.ok) return tags;
  return ok({ tags: tags.value });
};

export const aliasTag = async (
  deps: TagsDeps,
  input: { from: string; to: string },
): Promise<Result<TagsAliasOutput, AppError>> => {
  const from = normalizeTagName(input.from);
  const to = normalizeTagName(input.to);
  if (from.length === 0 || to.length === 0) {
    return { ok: false, error: appError('validation', 'Tag aliases must normalize to non-empty tag names') };
  }
  const aliased = await deps.globalCatalog.aliasTag({ from, to });
  if (!aliased.ok) return aliased;
  const flushed = await deps.globalCatalog.flush();
  if (!flushed.ok) return flushed;
  return aliased;
};

export const suggestTagAliases = async (deps: TagsDeps): Promise<Result<TagsSuggestAliasesOutput, AppError>> => {
  const tags = await deps.globalCatalog.listTags();
  if (!tags.ok) return tags;
  const aliases = await deps.globalCatalog.listTagAliases();
  if (!aliases.ok) return aliases;
  return ok({ proposals: proposeTagAliases({ tags: tags.value, aliases: aliases.value }) });
};
