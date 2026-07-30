import { describe, expect, it } from 'vitest';

import type { SpendLedgerEntry } from '@core/domain/index.js';

import { InMemoryConfig, InMemorySpendLedger } from '../../../test/server/usecases/test-fakes.js';
import { geminiMonthlyBudget, monthlyBudgetExceeded } from './budget.js';

const ledgerEntry = (overrides: Partial<SpendLedgerEntry> = {}): SpendLedgerEntry => ({
  kind: 'estimate',
  provider: 'gemini',
  model: 'gemini-3.6-flash',
  pricingMode: 'interactive',
  promptTokens: 100,
  candidatesTokens: 100,
  thoughtsTokens: 0,
  billedOutputTokens: 100,
  totalTokens: 200,
  inputPerMillionUsd: 1.5,
  outputPerMillionUsd: 7.5,
  estimatedCostUsd: 0.0015,
  schemaVersion: 1,
  recordedAt: '2026-08-01T00:00:00.000Z',
  month: '2026-08',
  providerId: 'gemini',
  videoPath: '/drive/video.mp4',
  runId: 'run-1',
  ...overrides,
});

describe('geminiMonthlyBudget', () => {
  it('returns null when unset', async () => {
    const config = new InMemoryConfig();
    const result = await geminiMonthlyBudget({ config });
    expect(result).toEqual({ ok: true, value: null });
  });

  it('returns the parsed cap when set', async () => {
    const config = new InMemoryConfig();
    await config.set({ kind: 'home' }, 'gemini_monthly_budget_usd', '1.5');
    const result = await geminiMonthlyBudget({ config });
    expect(result).toEqual({ ok: true, value: 1.5 });
  });
});

describe('monthlyBudgetExceeded', () => {
  const now = new Date('2026-08-04T00:00:00.000Z');

  it('returns null when uncapped', async () => {
    const config = new InMemoryConfig();
    const result = await monthlyBudgetExceeded({ config }, null, now);
    expect(result).toEqual({ ok: true, value: null });
  });

  it('returns null when under budget', async () => {
    const config = new InMemoryConfig();
    const spendLedger = new InMemorySpendLedger();
    await spendLedger.append(ledgerEntry({ month: '2026-08', estimatedCostUsd: 0.5 }));
    const result = await monthlyBudgetExceeded({ config, spendLedger }, 1, now);
    expect(result).toEqual({ ok: true, value: null });
  });

  it('returns the exceeded verdict at or over budget', async () => {
    const config = new InMemoryConfig();
    const spendLedger = new InMemorySpendLedger();
    await spendLedger.append(ledgerEntry({ month: '2026-08', estimatedCostUsd: 0.001 }));
    const result = await monthlyBudgetExceeded({ config, spendLedger }, 0.001, now);
    expect(result).toEqual({
      ok: true,
      value: { month: '2026-08', budgetUsd: 0.001, estimatedSpendUsd: 0.001 },
    });
  });

  it('fails with internal when a budget is set but the ledger dependency is missing', async () => {
    const config = new InMemoryConfig();
    const result = await monthlyBudgetExceeded({ config }, 1, now);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.code).toBe('internal');
  });
});
