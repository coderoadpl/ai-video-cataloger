import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { spendLedgerEntrySchema } from '@core/domain/index.js';

import { NdjsonSpendLedger } from './index.js';

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true });
});

const temporaryHome = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'avc-spend-ledger-'));
  directories.push(directory);
  return directory;
};

const entry = (overrides: { recordedAt?: string; month?: string; runId?: string | null; estimatedCostUsd?: number } = {}) =>
  spendLedgerEntrySchema.parse({
    schemaVersion: 1,
    kind: 'estimate',
    provider: 'gemini',
    providerId: 'gemini',
    model: 'gemini-3.6-flash',
    pricingMode: 'interactive',
    promptTokens: 1000,
    candidatesTokens: 100,
    thoughtsTokens: 50,
    billedOutputTokens: 150,
    totalTokens: 1150,
    inputPerMillionUsd: 1.5,
    outputPerMillionUsd: 7.5,
    estimatedCostUsd: overrides.estimatedCostUsd ?? 0.002625,
    recordedAt: overrides.recordedAt ?? '2026-08-01T10:00:00.000Z',
    month: overrides.month ?? '2026-08',
    videoPath: '/videos/clip.mp4',
    runId: overrides.runId ?? 'run-1',
  });

describe('NDJSON spend ledger', () => {
  it('appends estimates and totals them by provider, month, and run', async () => {
    const homeDirectory = await temporaryHome();
    const ledger = new NdjsonSpendLedger({ homeDirectory });
    await ledger.append(entry());
    await ledger.append(entry({ estimatedCostUsd: 0.01, runId: 'run-2' }));
    await ledger.append(entry({ recordedAt: '2026-07-31T10:00:00.000Z', month: '2026-07', estimatedCostUsd: 0.5 }));

    await expect(ledger.total({ provider: 'gemini', month: '2026-08' })).resolves.toEqual({
      ok: true,
      value: { entries: 2, estimatedCostUsd: 0.012625 },
    });
    await expect(ledger.total({ provider: 'gemini', runId: 'run-1' })).resolves.toEqual({
      ok: true,
      value: { entries: 2, estimatedCostUsd: 0.502625 },
    });
  });

  it('rejects a malformed persisted line at the read boundary', async () => {
    const homeDirectory = await temporaryHome();
    const directory = path.join(homeDirectory, '.ai-video-cataloger');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'spend-ledger.ndjson'), '{"provider":"gemini"}\n', 'utf8');

    const result = await new NdjsonSpendLedger({ homeDirectory }).total({ provider: 'gemini', month: '2026-08' });

    expect(result).toMatchObject({ ok: false, error: { code: 'read_error' } });
  });
});
