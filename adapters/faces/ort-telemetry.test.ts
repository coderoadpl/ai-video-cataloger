import { describe, expect, it, vi } from 'vitest';

import { disableOrtTelemetry } from '@adapters/faces/ort-telemetry.js';
import { defaultOrtSessionFactory } from '@adapters/faces/index.js';

describe('disableOrtTelemetry', () => {
  it('sets the flag when absent', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(disableOrtTelemetry(env)).toBe(true);
    expect(env.ORT_DISABLE_TELEMETRY).toBe('1');
  });

  it('leaves an existing "1" untouched', () => {
    const env: NodeJS.ProcessEnv = { ORT_DISABLE_TELEMETRY: '1' };
    expect(disableOrtTelemetry(env)).toBe(false);
    expect(env.ORT_DISABLE_TELEMETRY).toBe('1');
  });

  it('overwrites any other value, because telemetry is never opt-in', () => {
    const env: NodeJS.ProcessEnv = { ORT_DISABLE_TELEMETRY: '0' };
    expect(disableOrtTelemetry(env)).toBe(true);
    expect(env.ORT_DISABLE_TELEMETRY).toBe('1');
  });

  it('defaults to the process environment', () => {
    const previous = process.env.ORT_DISABLE_TELEMETRY;
    delete process.env.ORT_DISABLE_TELEMETRY;
    try {
      disableOrtTelemetry();
      expect(process.env.ORT_DISABLE_TELEMETRY).toBe('1');
    } finally {
      if (previous === undefined) {
        delete process.env.ORT_DISABLE_TELEMETRY;
      } else {
        process.env.ORT_DISABLE_TELEMETRY = previous;
      }
    }
  });
});

const telemetryFlagAtImport: { value: string | undefined } = { value: 'unset' };

vi.mock('onnxruntime-node', () => {
  telemetryFlagAtImport.value = process.env.ORT_DISABLE_TELEMETRY;
  return {
    InferenceSession: {
      create: async (): Promise<{ inputNames: readonly string[]; outputNames: readonly string[]; run: () => Promise<Record<string, never>> }> => ({
        inputNames: ['in'],
        outputNames: ['out'],
        run: async () => ({}),
      }),
    },
  };
});

describe('defaultOrtSessionFactory', () => {
  it('disables telemetry before onnxruntime-node is loaded', async () => {
    const previous = process.env.ORT_DISABLE_TELEMETRY;
    delete process.env.ORT_DISABLE_TELEMETRY;
    try {
      await defaultOrtSessionFactory.create('model.onnx', ['cpu']);
      expect(telemetryFlagAtImport.value).toBe('1');
    } finally {
      if (previous === undefined) {
        delete process.env.ORT_DISABLE_TELEMETRY;
      } else {
        process.env.ORT_DISABLE_TELEMETRY = previous;
      }
    }
  });
});
