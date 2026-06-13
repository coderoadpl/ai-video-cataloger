/**
 * TerminalLog - virtualized terminal output panel.
 *
 * Renders pre-parsed ANSI segments (see hooks/use-terminal-log.ts) through
 * @tanstack/react-virtual so only the visible lines hit the DOM. Preserves
 * the JSON filter, copy, autoscroll-unless-scrolled-up and the optional
 * header of the previous implementation.
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { stripAnsi } from '@/lib/ansi';
import type { LogLine } from '@/hooks/use-terminal-log';

// Re-export so existing consumers can keep importing from this module
export type { LogLine } from '@/hooks/use-terminal-log';
export { createLogLine } from '@/hooks/use-terminal-log';

// A line is considered JSON output when it is a single {...} object
function isJsonLine(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}');
}

interface TerminalLogProps {
  lines: LogLine[];
  /** Number of lines dropped from the ring buffer (shown above the log). */
  droppedCount?: number;
  /** When false, JSON event lines are hidden (default true). */
  showJson?: boolean;
  onClear?: () => void;
  className?: string;
  autoScroll?: boolean;
  showHeader?: boolean;
}

function getLineTypeClasses(type: LogLine['type']): string {
  switch (type) {
    case 'stderr':
    case 'error':
      return 'text-red-400';
    case 'success':
      return 'text-green-400';
    case 'info':
      return 'text-blue-400';
    case 'stdout':
    default:
      return 'text-gray-200';
  }
}

export function TerminalLog({
  lines,
  droppedCount = 0,
  showJson = true,
  onClear,
  className,
  autoScroll = true,
  showHeader = true,
}: TerminalLogProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Filter JSON lines based on showJson setting
  const visibleLines = useMemo(
    () => (showJson ? lines : lines.filter((line) => !isJsonLine(line.content))),
    [lines, showJson]
  );

  const virtualizer = useVirtualizer({
    count: visibleLines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 21,
    overscan: 10,
    getItemKey: (index) => visibleLines[index].id,
  });

  // Auto-scroll to bottom when new lines are added (unless the user scrolled up)
  useEffect(() => {
    if (autoScroll && !userScrolledUp && visibleLines.length > 0) {
      virtualizer.scrollToIndex(visibleLines.length - 1, { align: 'end' });
    }
  }, [visibleLines.length, autoScroll, userScrolledUp, virtualizer]);

  // Track if user has scrolled up (check scroll container)
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setUserScrolledUp(!isAtBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    setUserScrolledUp(false);
    if (visibleLines.length > 0) {
      virtualizer.scrollToIndex(visibleLines.length - 1, { align: 'end' });
    }
  }, [virtualizer, visibleLines.length]);

  // Copy the visible log contents to clipboard
  const handleCopy = useCallback(async () => {
    const plainText = visibleLines
      .map((line) => stripAnsi(line.content))
      .join('\n');

    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }, [visibleLines]);

  return (
    <div
      className={cn(
        'flex flex-col bg-[#1e1e1e] overflow-hidden',
        showHeader && 'rounded-lg border border-border',
        className
      )}
    >
      {/* Header with controls */}
      {showHeader && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-[#252526]">
          <span className="text-xs font-medium text-gray-400">Terminal</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-gray-400 hover:text-white hover:bg-white/10"
              onClick={handleCopy}
              title="Copy log contents"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            {onClear && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-gray-400 hover:text-white hover:bg-white/10"
                onClick={onClear}
                title="Clear log"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Log content (virtualized) */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto scrollbar-macos"
        onScroll={handleScroll}
      >
        <div className="p-3 font-mono text-sm leading-relaxed">
          {droppedCount > 0 && (
            <div className="text-gray-500 italic">
              {droppedCount} earlier line(s) dropped
            </div>
          )}
          {visibleLines.length === 0 ? (
            <div className="text-gray-500 italic">
              No output yet. Run a command to see results here.
            </div>
          ) : (
            <div
              className="relative w-full"
              style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const line = visibleLines[item.index];
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className={cn(
                      'absolute top-0 left-0 w-full whitespace-pre-wrap break-all',
                      getLineTypeClasses(line.type)
                    )}
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {line.segments.map((segment, i) => (
                      <span key={i} className={cn(segment.classes)}>
                        {segment.text}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Scroll to bottom indicator */}
      {userScrolledUp && visibleLines.length > 0 && (
        <button
          className="absolute bottom-4 right-4 px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md shadow-md hover:bg-primary/90 transition-colors"
          onClick={scrollToBottom}
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
