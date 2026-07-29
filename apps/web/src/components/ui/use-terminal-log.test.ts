import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  appendLine,
  mergeLogLines,
  renderLine,
  serializeRaw,
  MAX_LOG_LINES,
  useTerminalLog,
  type LogLine,
} from './use-terminal-log.js';

const line = (n: number): LogLine => ({
  id: `l${String(n)}`,
  at: n,
  content: `line ${String(n)}`,
  type: 'info',
  raw: null,
});

describe('terminal ring buffer', () => {
  it('caps at MAX_LOG_LINES and counts the lines it drops', () => {
    let state: { lines: LogLine[]; dropped: number } = { lines: [], dropped: 0 };
    for (let i = 0; i < MAX_LOG_LINES + 3; i += 1) state = appendLine(state, line(i), MAX_LOG_LINES);

    expect(state.lines.length).toBe(MAX_LOG_LINES);
    expect(state.dropped).toBe(3);
    expect(state.lines.at(0)?.content).toBe('line 3');
    expect(state.lines.at(-1)?.content).toBe(`line ${String(MAX_LOG_LINES + 2)}`);
  });

  it('drops the oldest lines once the hook buffer overflows', () => {
    const { result } = renderHook(() => useTerminalLog({ maxLines: 2 }));

    act(() => {
      result.current.addLine('a');
      result.current.addLine('b');
      result.current.addLine('c');
    });

    expect(result.current.lines.map((l) => l.content)).toEqual(['b', 'c']);
    expect(result.current.droppedCount).toBe(1);
  });

  it('attaches a serialized raw payload when addLine receives one', () => {
    const { result } = renderHook(() => useTerminalLog());

    act(() => {
      result.current.addLine('progress 10%', 'info', { raw: { step: 'transcribe', percentage: 10 } });
    });

    expect(result.current.lines[0]?.raw).toBe(
      JSON.stringify({ step: 'transcribe', percentage: 10 }, null, 2),
    );
  });

  it('leaves raw null when no payload is given', () => {
    const { result } = renderHook(() => useTerminalLog());

    act(() => {
      result.current.addLine('plain line');
    });

    expect(result.current.lines[0]?.raw).toBeNull();
  });
});

describe('serializeRaw', () => {
  it('pretty-prints a value', () => {
    expect(serializeRaw({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it('returns null for undefined', () => {
    expect(serializeRaw(undefined)).toBeNull();
  });

  it('returns null instead of throwing on a value JSON.stringify cannot serialize', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeRaw(circular)).toBeNull();
  });
});

describe('mergeLogLines', () => {
  it('interleaves job and api lines in timestamp order, stable on ties', () => {
    const job = { ...line(1), id: 'job-1', at: 100 };
    const apiA = { ...line(2), id: 'api-1', at: 100 };
    const apiB = { ...line(3), id: 'api-2', at: 50 };

    const merged = mergeLogLines([job], [apiA, apiB]);

    expect(merged.map((l) => l.id)).toEqual(['api-2', 'job-1', 'api-1']);
  });
});

describe('renderLine', () => {
  it('renders content in friendly mode', () => {
    expect(renderLine({ ...line(1), raw: '{"a":1}' }, 'friendly')).toBe('line 1');
  });

  it('renders the raw payload in raw mode', () => {
    expect(renderLine({ ...line(1), raw: '{"a":1}' }, 'raw')).toBe('{"a":1}');
  });

  it('falls back to content in raw mode when there is no raw payload', () => {
    expect(renderLine({ ...line(1), raw: null }, 'raw')).toBe('line 1');
  });
});
