import {
  appError,
  configValueSchema,
  ok,
  spendMonth,
  type AppError,
  type Result,
} from '@core/domain/index.js';

import type { ConfigStore, SpendLedgerPort } from '../ports.js';
import { resolveConfigValues } from './config-resolution.js';

export interface BudgetDeps {
  config: ConfigStore;
  spendLedger?: SpendLedgerPort | undefined;
}

export interface BudgetExceeded {
  month: string;
  budgetUsd: number;
  estimatedSpendUsd: number;
}

export const geminiMonthlyBudget = async (deps: BudgetDeps): Promise<Result<number | null, AppError>> => {
  const resolved = await resolveConfigValues(deps.config);
  if (!resolved.ok) return resolved;
  const parsed = configValueSchema.shape.gemini_monthly_budget_usd.safeParse(
    resolved.value.effective.gemini_monthly_budget_usd,
  );
  if (!parsed.success) {
    return {
      ok: false,
      error: appError('invalid_config_value', 'gemini_monthly_budget_usd does not match the config schema'),
    };
  }
  return ok(parsed.data);
};

export const monthlyBudgetExceeded = async (
  deps: BudgetDeps,
  budgetUsd: number | null,
  now: Date,
): Promise<Result<BudgetExceeded | null, AppError>> => {
  if (budgetUsd === null) return ok(null);
  if (deps.spendLedger === undefined) {
    return { ok: false, error: appError('internal', 'Spend ledger dependencies are required for a Gemini budget cap') };
  }
  const month = spendMonth(now);
  const spend = await deps.spendLedger.total({ provider: 'gemini', month });
  if (!spend.ok) return spend;
  if (spend.value.estimatedCostUsd < budgetUsd) return ok(null);
  return ok({ month, budgetUsd, estimatedSpendUsd: spend.value.estimatedCostUsd });
};
