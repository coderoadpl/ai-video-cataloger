import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatMatrixSummary, matrixAllowsSkip, matrixHome, missingLegMessage } from './matrix-support.js';

describe('matrix support', () => {
  it('uses the persistent scratch cache unless explicitly overridden', () => {
    expect(matrixHome({})).toBe(join(homedir(), '.ai-video-cataloger-scratch', 'avc-e2e-matrix-home'));
    expect(matrixHome({ AVC_SCRATCH_DIR: '/scratch-base' })).toBe('/scratch-base/avc-e2e-matrix-home');
    expect(matrixHome({ E2E_MATRIX_HOME: '/matrix-cache', AVC_SCRATCH_DIR: '/scratch-base' })).toBe('/matrix-cache');
  });

  it('requires an explicit skip opt-out', () => {
    expect(matrixAllowsSkip(undefined)).toBe(false);
    expect(matrixAllowsSkip('0')).toBe(false);
    expect(matrixAllowsSkip('1')).toBe(true);
    expect(matrixAllowsSkip('true')).toBe(true);
  });

  it('renders loud preflight guidance and the final cell table', () => {
    expect(missingLegMessage('harness-codex', 'not authenticated')).toContain(
      'E2E MATRIX PREFLIGHT FAILED [harness-codex]\nnot authenticated',
    );
    expect(formatMatrixSummary([
      { cell: 'local-managed', result: 'passed', durationMs: 1250 },
      { cell: 'api-whisper', result: 'skipped', durationMs: 0 },
    ])).toBe(
      'E2E MATRIX SUMMARY\n' +
      'CELL          | RESULT  | DURATION\n' +
      '--------------+---------+---------\n' +
      'local-managed | passed  |     1.3s\n' +
      'api-whisper   | skipped |     0.0s',
    );
  });
});
