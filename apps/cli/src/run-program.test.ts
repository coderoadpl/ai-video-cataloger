import { describe, expect, it, vi } from 'vitest';

import { runProgram } from './run-program.js';

describe('runProgram', () => {
  it('prints the legacy fatal-error line, exits 1, and disposes after an unexpected throw', async () => {
    const dispose = vi.fn(() => Promise.resolve());
    const writeError = vi.fn();

    const exitCode = await runProgram(
      () => Promise.reject(new Error('unexpected failure')),
      dispose,
      writeError,
    );

    expect(exitCode).toBe(1);
    expect(writeError).toHaveBeenCalledWith('Fatal error: unexpected failure\n');
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('also handles an unexpected disposal failure', async () => {
    const writeError = vi.fn();

    const exitCode = await runProgram(
      () => Promise.resolve(),
      () => Promise.reject(new Error('dispose failed')),
      writeError,
    );

    expect(exitCode).toBe(1);
    expect(writeError).toHaveBeenCalledWith('Fatal error: dispose failed\n');
  });
});
