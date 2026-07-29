import { useCallback, useState } from 'react';

export const MAX_LOG_LINES = 5000;

export type LogLineType = 'info' | 'success' | 'error' | 'stdout' | 'stderr';
export type TerminalViewMode = 'friendly' | 'raw';

export interface LogLine {
  id: string;
  at: number;
  content: string;
  type: LogLineType;
  raw: string | null;
}

export interface AddLogLineOptions {
  raw?: unknown;
}

export type AddLogLine = (content: string, type?: LogLineType, options?: AddLogLineOptions) => void;

export interface TerminalLogState {
  lines: readonly LogLine[];
  droppedCount: number;
  addLine: AddLogLine;
  clear: () => void;
}

interface BufferState {
  lines: LogLine[];
  dropped: number;
}

const EMPTY_BUFFER: BufferState = { lines: [], dropped: 0 };

export const serializeRaw = (value: unknown): string | null => {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
};

export const mergeLogLines = (
  lines: readonly LogLine[],
  apiLines: readonly LogLine[],
): readonly LogLine[] => [...lines, ...apiLines].sort((a, b) => a.at - b.at);

export const renderLine = (line: LogLine, mode: TerminalViewMode): string =>
  mode === 'raw' ? (line.raw ?? line.content) : line.content;

export const appendLine = (state: BufferState, line: LogLine, maxLines: number): BufferState => {
  const lines = [...state.lines, line];
  const overflow = lines.length - maxLines;
  if (overflow > 0) return { lines: lines.slice(overflow), dropped: state.dropped + overflow };
  return { lines, dropped: state.dropped };
};

let lineCounter = 0;
const nextLineId = (): string => `log-${Date.now()}-${(lineCounter += 1)}`;

export interface UseTerminalLogOptions {
  maxLines?: number;
}

export const useTerminalLog = (options: UseTerminalLogOptions = {}): TerminalLogState => {
  const { maxLines = MAX_LOG_LINES } = options;
  const [buffer, setBuffer] = useState<BufferState>(EMPTY_BUFFER);

  const addLine = useCallback<AddLogLine>(
    (content, type = 'stdout', options) => {
      const line: LogLine = {
        id: nextLineId(),
        at: Date.now(),
        content,
        type,
        raw: serializeRaw(options?.raw),
      };
      setBuffer((prev) => appendLine(prev, line, maxLines));
    },
    [maxLines],
  );

  const clear = useCallback(() => setBuffer(EMPTY_BUFFER), []);

  return { lines: buffer.lines, droppedCount: buffer.dropped, addLine, clear };
};
