import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Typography, type Theme } from '@mui/material';

import type { LogLine, LogLineType } from './use-terminal-log.js';

interface TerminalLogProps {
  lines: readonly LogLine[];
  droppedCount?: number;
  showJson?: boolean;
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

/**
 * The terminal panel body: structured job/event lines with a JSON-visibility
 * filter, a dropped-line notice for the ring buffer, and auto-scroll that yields
 * to the user (scrolling up pauses it and surfaces a "scroll to bottom" button —
 * parity-inventory §2). The panel's copy/clear/JSON controls live in the
 * enclosing AppLayout toolbar; this component only renders the buffer.
 */
export const TerminalLog = ({ lines, droppedCount = 0, showJson = false }: TerminalLogProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinnedUp, setPinnedUp] = useState(false);

  const visibleLines = useMemo(
    () => (showJson ? lines : lines.filter((line) => !line.isJson)),
    [lines, showJson],
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
            {droppedCount} earlier line(s) dropped
          </Typography>
        ) : null}
        {visibleLines.length === 0 ? (
          <Typography variant="caption" sx={{ color: 'grey.500', fontStyle: 'italic' }}>
            No output yet. Run an analysis to see job progress here.
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
              {line.content}
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
          Scroll to bottom
        </Button>
      ) : null}
    </Box>
  );
};
