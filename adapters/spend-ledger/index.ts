import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import {
  appError,
  ok,
  spendLedgerEntrySchema,
  type AppError,
  type Result,
  type SpendLedgerEntry,
} from '@core/domain/index.js';
import type { SpendLedgerPort, SpendLedgerTotal } from '@core/server/index.js';

const spendLedgerQuerySchema = z.object({
  provider: z.literal('gemini'),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  runId: z.string().min(1).optional(),
});

export interface NdjsonSpendLedgerOptions {
  homeDirectory?: string | undefined;
}

export class NdjsonSpendLedger implements SpendLedgerPort {
  private readonly filePath: string;

  constructor(options: NdjsonSpendLedgerOptions = {}) {
    this.filePath = path.join(options.homeDirectory ?? homedir(), '.ai-video-cataloger', 'spend-ledger.ndjson');
  }

  async append(entry: SpendLedgerEntry): Promise<Result<void, AppError>> {
    const parsed = spendLedgerEntrySchema.safeParse(entry);
    if (!parsed.success) {
      return { ok: false, error: appError('internal', 'Spend ledger entry does not match the schema', parsed.error.flatten()) };
    }
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(parsed.data)}\n`, 'utf8');
      return ok(undefined);
    } catch (cause) {
      return { ok: false, error: appError('internal', `Failed to append spend ledger: ${this.filePath}`, cause) };
    }
  }

  async total(input: {
    provider: 'gemini';
    month?: string | undefined;
    runId?: string | undefined;
  }): Promise<Result<SpendLedgerTotal, AppError>> {
    const query = spendLedgerQuerySchema.safeParse(input);
    if (!query.success) {
      return { ok: false, error: appError('internal', 'Spend ledger query does not match the schema', query.error.flatten()) };
    }
    const entries = await this.readEntries();
    if (!entries.ok) return entries;
    const matching = entries.value.filter((entry) =>
      entry.provider === query.data.provider
      && (query.data.month === undefined || entry.month === query.data.month)
      && (query.data.runId === undefined || entry.runId === query.data.runId));
    return ok({
      entries: matching.length,
      estimatedCostUsd: matching.reduce((total, entry) => total + entry.estimatedCostUsd, 0),
    });
  }

  private async readEntries(): Promise<Result<SpendLedgerEntry[], AppError>> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (cause) {
      if (z.object({ code: z.literal('ENOENT') }).safeParse(cause).success) return ok([]);
      return { ok: false, error: appError('read_error', `Failed to read spend ledger: ${this.filePath}`, cause) };
    }
    const entries: SpendLedgerEntry[] = [];
    for (const [index, line] of content.split('\n').entries()) {
      if (line.trim().length === 0) continue;
      let decoded: unknown;
      try {
        decoded = JSON.parse(line);
      } catch {
        return { ok: false, error: appError('read_error', `Spend ledger line ${String(index + 1)} is not valid JSON`) };
      }
      const parsed = spendLedgerEntrySchema.safeParse(decoded);
      if (!parsed.success) {
        return {
          ok: false,
          error: appError('read_error', `Spend ledger line ${String(index + 1)} does not match the schema`, parsed.error.flatten()),
        };
      }
      entries.push(parsed.data);
    }
    return ok(entries);
  }
}
