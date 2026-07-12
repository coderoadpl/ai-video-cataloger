import { EXIT_CODE_BY_ERROR_CODE } from '@core/contract/index.js';
import type { AppError, Result } from '@core/domain/index.js';

/**
 * Single output funnel for every command:
 *  --json  → exactly one JSON envelope line on stdout (the agent contract),
 *  human   → readable line(s) on stdout, errors on stderr.
 * Exit code is always mapped from the error taxonomy — never ad hoc.
 */
export const emit = <T>(result: Result<T, AppError>, json: boolean, human: (value: T) => string): void => {
  if (json) {
    const envelope = result.ok
      ? { ok: true, data: result.value }
      : { ok: false, error: result.error };
    console.log(JSON.stringify(envelope));
  } else if (result.ok) {
    console.log(human(result.value));
  } else {
    console.error(`error(${result.error.code}): ${result.error.message}`);
  }
  if (!result.ok) process.exitCode = EXIT_CODE_BY_ERROR_CODE[result.error.code];
};
