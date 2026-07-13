import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { appendLine, MAX_LOG_LINES, useTerminalLog, type LogLine } from './use-terminal-log.js';

const line = (n: number): LogLine => ({ id: `l${String(n)}`, content: `line ${String(n)}`, type: 'info', isJson: false });

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
});
