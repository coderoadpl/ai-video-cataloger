import { describe, expect, it } from 'vitest';

import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';

describe('models whisper-runtime', () => {
  it('emits additive NDJSON status events with runtime and build-tool detection', async () => {
    const result = await runCli(['models', 'whisper-runtime', 'status', '--json']);

    expect(result.exitCode).toBe(0);
    const events = parseJsonEvents(result.stdout);
    expect(findEvent(events, 'started')).toMatchObject({ command: 'models_whisper_runtime_status' });
    expect(findEvent(events, 'completed')?.data).toMatchObject({
      available: expect.any(Boolean),
      managedInstalled: false,
      buildToolsAvailable: expect.any(Boolean),
      missingBuildTools: expect.any(Array),
    });
  });
});
