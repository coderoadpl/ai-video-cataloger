import { useCallback, useState } from 'react';

export const MAX_LOG_LINES = 5000;

export type LogLineType = 'info' | 'success' | 'error' | 'stdout' | 'stderr';

export interface LogLine {
  id: string;
  content: string;
  type: LogLineType;
  isJson: boolean;
}

export type AddLogLine = (content: string, type?: LogLineType, isJson?: boolean) => void;

export interface TerminalLogState {
  lines: readonly LogLine[];
  droppedCount: number;
  addLine: AddLogLine;
  clear: () => void;
  copyText: () => string;
}

interface BufferState {
  lines: LogLine[];
  dropped: number;
}

const EMPTY_BUFFER: BufferState = { lines: [], dropped: 0 };

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
    (content, type = 'stdout', isJson = false) => {
      const line: LogLine = { id: nextLineId(), content, type, isJson };
      setBuffer((prev) => appendLine(prev, line, maxLines));
    },
    [maxLines],
  );

  const clear = useCallback(() => setBuffer(EMPTY_BUFFER), []);

  const copyText = useCallback(() => buffer.lines.map((line) => line.content).join('\n'), [buffer.lines]);

  return { lines: buffer.lines, droppedCount: buffer.dropped, addLine, clear, copyText };
};
