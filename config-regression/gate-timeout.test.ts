import { afterEach, describe, expect, it } from 'vitest';

import { gateTimeoutFactor, scaledTimeout } from '../test/helpers/gate-timeout.js';

const originalFactor = process.env.AVC_GATE_TIMEOUT_FACTOR;

afterEach(() => {
  if (originalFactor === undefined) {
    delete process.env.AVC_GATE_TIMEOUT_FACTOR;
  } else {
    process.env.AVC_GATE_TIMEOUT_FACTOR = originalFactor;
  }
});

describe('gate timeout scaling', () => {
  it('multiplies wall-clock budgets by AVC_GATE_TIMEOUT_FACTOR', () => {
    process.env.AVC_GATE_TIMEOUT_FACTOR = '3';

    expect(gateTimeoutFactor()).toBe(3);
    expect(scaledTimeout(5_000)).toBe(15_000);
  });

  it('falls back to the base budget for invalid factors', () => {
    process.env.AVC_GATE_TIMEOUT_FACTOR = '0';

    expect(gateTimeoutFactor()).toBe(1);
    expect(scaledTimeout(5_000)).toBe(5_000);
  });
});
