import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Typography, type Theme } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';
import { mergeLogLines, renderLine, type LogLine, type LogLineType, type TerminalViewMode } from './use-terminal-log.js';

interface TerminalLogProps {
  lines: readonly LogLine[];
  apiLines?: readonly LogLine[];
  droppedCount?: number;
  mode?: TerminalViewMode;
}

const AT_BOTTOM_THRESHOLD = 24;

const colorForType =
  (type: LogLineType) =>
  (theme: Theme): string => {
    switch (type) {
      case 'error':
      case 'stderr':
        return theme.palette.status.error.main;
      case 'success':
        return theme.palette.status.completed.main;
      case 'info':
        return theme.palette.status.inProgress.main;
      case 'stdout':
        return theme.palette.grey[300];
    }
  };

export const TerminalLog = ({
  lines,
  apiLines = [],
  droppedCount = 0,
  mode = 'friendly',
}: TerminalLogProps) => {
  const dictionary = useDictionary();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinnedUp, setPinnedUp] = useState(false);

  const visibleLines = useMemo(
    () => (mode === 'raw' ? mergeLogLines(lines, apiLines) : lines),
    [lines, apiLines, mode],
  );

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    setPinnedUp(false);
  }, []);

  useEffect(() => {
    if (!pinnedUp) scrollToBottom();
  }, [visibleLines.length, pinnedUp, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinnedUp(distanceFromBottom > AT_BOTTOM_THRESHOLD);
  }, []);

  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        sx={{ height: '100%', overflow: 'auto', p: 1.5, fontFamily: 'monospace', fontSize: '0.75rem' }}
      >
        {droppedCount > 0 ? (
          <Typography
            variant="caption"
            component="div"
            sx={{ color: 'grey.500', fontStyle: 'italic', mb: 0.5 }}
          >
            {dictionary.appFrame.terminalDropped(droppedCount)}
          </Typography>
        ) : null}
        {visibleLines.length === 0 ? (
          <Typography variant="caption" sx={{ color: 'grey.500', fontStyle: 'italic' }}>
            {dictionary.appFrame.terminalEmpty}
          </Typography>
        ) : (
          visibleLines.map((line) => (
            <Box
              key={line.id}
              component="div"
              sx={(theme) => ({
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                lineHeight: 1.6,
                color: colorForType(line.type)(theme),
              })}
            >
              {renderLine(line, mode)}
            </Box>
          ))
        )}
      </Box>
      {pinnedUp && visibleLines.length > 0 ? (
        <Button
          size="small"
          variant="contained"
          onClick={scrollToBottom}
          sx={{ position: 'absolute', bottom: 8, right: 12, minWidth: 0, py: 0.25, px: 1 }}
        >
          {dictionary.appFrame.terminalScrollToBottom}
        </Button>
      ) : null}
    </Box>
  );
};
