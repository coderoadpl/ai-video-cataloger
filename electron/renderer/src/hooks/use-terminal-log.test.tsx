import { describe, it, expect, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import {
  useTerminalLog,
  MAX_LOG_LINES,
  type UseTerminalLogResult,
} from '@/hooks/use-terminal-log';
import { TerminalLog } from '@/components/terminal-log';
import type { AnsiSegment } from '@/lib/ansi';

describe('useTerminalLog', () => {
  it('T5: ring buffer holds 5000 lines, drops oldest, counts dropped', () => {
    const { result } = renderHook(() => useTerminalLog());

    act(() => {
      for (let i = 0; i < 5100; i++) {
        result.current.addLine(`line ${i}`);
      }
    });

    expect(MAX_LOG_LINES).toBe(5000);
    expect(result.current.lines).toHaveLength(5000);
    // The 100 oldest lines are gone; the buffer starts at line 100
    expect(result.current.lines[0].content).toBe('line 100');
    expect(result.current.lines[4999].content).toBe('line 5099');
    expect(result.current.droppedCount).toBe(100);
  });

  it('stores parsed ANSI segments per line and clear resets the buffer', () => {
    const { result } = renderHook(() => useTerminalLog());

    act(() => {
      result.current.addLine('\x1b[32mok\x1b[0m plain', 'success');
    });

    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0].segments).toEqual([
      { text: 'ok', classes: ['text-green-500'] },
      { text: ' plain', classes: [] },
    ]);

    act(() => {
      result.current.clear();
    });
    expect(result.current.lines).toHaveLength(0);
    expect(result.current.droppedCount).toBe(0);
  });

  it('T6: parser runs exactly once per appended line, never on re-render', () => {
    const parseSpy = vi.fn(
      (input: string): AnsiSegment[] => [{ text: input, classes: [] }]
    );

    let api: UseTerminalLogResult | undefined;
    function Fixture({ label }: { label: string }): JSX.Element {
      api = useTerminalLog({ parse: parseSpy });
      return (
        <div data-label={label}>
          <TerminalLog
            lines={api.lines}
            droppedCount={api.droppedCount}
            autoScroll={false}
            showHeader={false}
          />
        </div>
      );
    }

    const { rerender } = render(<Fixture label="first" />);
    expect(parseSpy).toHaveBeenCalledTimes(0);

    const N = 50;
    act(() => {
      for (let i = 0; i < N; i++) {
        api!.addLine(`\x1b[36mline ${i}\x1b[0m`);
      }
    });

    // Appending N lines parses exactly N times
    expect(parseSpy).toHaveBeenCalledTimes(N);

    // Re-rendering the component does not re-parse anything
    rerender(<Fixture label="second" />);
    rerender(<Fixture label="third" />);
    expect(parseSpy).toHaveBeenCalledTimes(N);
  });
});
