/**
 * useTerminalLog - terminal log lines state as a bounded ring buffer.
 *
 * - Capped at MAX_LOG_LINES (oldest lines are dropped first); the number of
 *   dropped lines is exposed to the UI via droppedCount.
 * - ANSI escape sequences are parsed ONCE at append time and stored as
 *   segments per line, so re-renders never re-parse. The parse function is
 *   injectable (options.parse) so tests can spy on / count calls.
 */

import { useCallback, useRef, useState } from 'react';
import { parseAnsiString, stripAnsi, type AnsiSegment } from '@/lib/ansi';

/** Maximum number of lines kept in the buffer; oldest are dropped beyond it. */
export const MAX_LOG_LINES = 5000;

export interface LogLine {
  id: string;
  content: string;
  type: 'stdout' | 'stderr' | 'info' | 'error' | 'success';
  timestamp: Date;
  /** ANSI segments parsed once at append time (never re-parsed on render). */
  segments: AnsiSegment[];
}

// Helper to create a log line with unique ID
let lineIdCounter = 0;

export function createLogLine(
  content: string,
  type: LogLine['type'] = 'stdout',
  segments?: AnsiSegment[]
): LogLine {
  return {
    id: `log-${Date.now()}-${lineIdCounter++}`,
    content,
    type,
    timestamp: new Date(),
    segments: segments ?? parseAnsiString(content),
  };
}

export interface UseTerminalLogOptions {
  /** Buffer capacity (defaults to MAX_LOG_LINES). */
  maxLines?: number;
  /** ANSI parser used at append time (defaults to parseAnsiString). */
  parse?: (input: string) => AnsiSegment[];
}

export interface UseTerminalLogResult {
  lines: LogLine[];
  /** Total number of lines dropped from the buffer so far. */
  droppedCount: number;
  addLine: (content: string, type?: LogLine['type']) => void;
  clear: () => void;
  /** Copy all buffered lines (ANSI stripped) to the clipboard. */
  copyToClipboard: () => Promise<void>;
}

interface BufferState {
  lines: LogLine[];
  dropped: number;
}

const EMPTY_BUFFER: BufferState = { lines: [], dropped: 0 };

export function useTerminalLog(options: UseTerminalLogOptions = {}): UseTerminalLogResult {
  const { maxLines = MAX_LOG_LINES, parse = parseAnsiString } = options;
  const [buffer, setBuffer] = useState<BufferState>(EMPTY_BUFFER);

  // Keep the latest parse function in a ref so addLine stays stable
  const parseRef = useRef(parse);
  parseRef.current = parse;

  const addLine = useCallback(
    (content: string, type: LogLine['type'] = 'stdout') => {
      // Parse exactly once per appended line, outside the state updater
      // (updaters may run more than once in StrictMode).
      const line = createLogLine(content, type, parseRef.current(content));
      setBuffer((prev) => {
        const lines = [...prev.lines, line];
        const overflow = lines.length - maxLines;
        if (overflow > 0) {
          // Drop the oldest lines and count them
          return { lines: lines.slice(overflow), dropped: prev.dropped + overflow };
        }
        return { lines, dropped: prev.dropped };
      });
    },
    [maxLines]
  );

  const clear = useCallback(() => {
    setBuffer(EMPTY_BUFFER);
  }, []);

  const copyToClipboard = useCallback(async () => {
    // Strip ANSI codes when copying
    const plainText = buffer.lines.map((line) => stripAnsi(line.content)).join('\n');
    await navigator.clipboard.writeText(plainText);
  }, [buffer.lines]);

  return {
    lines: buffer.lines,
    droppedCount: buffer.dropped,
    addLine,
    clear,
    copyToClipboard,
  };
}
