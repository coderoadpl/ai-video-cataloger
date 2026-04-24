import { useRef, useEffect, useCallback, useState } from 'react';
import { Copy, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ANSI color codes to CSS class mapping
const ANSI_COLORS: Record<string, string> = {
  '30': 'text-black',
  '31': 'text-red-500',
  '32': 'text-green-500',
  '33': 'text-yellow-500',
  '34': 'text-blue-500',
  '35': 'text-purple-500',
  '36': 'text-cyan-500',
  '37': 'text-white',
  '90': 'text-gray-500',
  '91': 'text-red-400',
  '92': 'text-green-400',
  '93': 'text-yellow-400',
  '94': 'text-blue-400',
  '95': 'text-purple-400',
  '96': 'text-cyan-400',
  '97': 'text-white',
};

const ANSI_BG_COLORS: Record<string, string> = {
  '40': 'bg-black',
  '41': 'bg-red-500',
  '42': 'bg-green-500',
  '43': 'bg-yellow-500',
  '44': 'bg-blue-500',
  '45': 'bg-purple-500',
  '46': 'bg-cyan-500',
  '47': 'bg-white',
};

const ANSI_STYLES: Record<string, string> = {
  '1': 'font-bold',
  '2': 'opacity-70',
  '3': 'italic',
  '4': 'underline',
};

interface AnsiSegment {
  text: string;
  classes: string[];
}

function parseAnsiString(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  // Match ANSI escape sequences: ESC[ followed by params and ending with 'm'
  const ansiRegex = /\x1b\[([0-9;]*)m/g;

  let lastIndex = 0;
  let currentClasses: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(input)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      const text = input.slice(lastIndex, match.index);
      if (text) {
        segments.push({ text, classes: [...currentClasses] });
      }
    }

    // Parse the ANSI codes
    const codes = match[1].split(';').filter(Boolean);

    for (const code of codes) {
      if (code === '0' || code === '') {
        // Reset all styles
        currentClasses = [];
      } else if (ANSI_COLORS[code]) {
        // Remove any existing text color and add new one
        currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
        currentClasses.push(ANSI_COLORS[code]);
      } else if (ANSI_BG_COLORS[code]) {
        // Remove any existing bg color and add new one
        currentClasses = currentClasses.filter(c => !c.startsWith('bg-'));
        currentClasses.push(ANSI_BG_COLORS[code]);
      } else if (ANSI_STYLES[code]) {
        if (!currentClasses.includes(ANSI_STYLES[code])) {
          currentClasses.push(ANSI_STYLES[code]);
        }
      }
    }

    lastIndex = ansiRegex.lastIndex;
  }

  // Add remaining text after last escape sequence
  if (lastIndex < input.length) {
    const text = input.slice(lastIndex);
    if (text) {
      segments.push({ text, classes: [...currentClasses] });
    }
  }

  // If no segments were created (no ANSI codes), return the whole string
  if (segments.length === 0 && input) {
    segments.push({ text: input, classes: [] });
  }

  return segments;
}

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}

export interface LogLine {
  id: string;
  content: string;
  type: 'stdout' | 'stderr' | 'info' | 'error' | 'success';
  timestamp: Date;
}

interface TerminalLogProps {
  lines: LogLine[];
  onClear?: () => void;
  className?: string;
  autoScroll?: boolean;
  showHeader?: boolean;
}

export function TerminalLog({
  lines,
  onClear,
  className,
  autoScroll = true,
  showHeader = true,
}: TerminalLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Auto-scroll to bottom when new lines are added
  useEffect(() => {
    if (autoScroll && !userScrolledUp && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [lines, autoScroll, userScrolledUp]);

  // Track if user has scrolled up
  const handleScroll = useCallback(() => {
    if (viewportRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setUserScrolledUp(!isAtBottom);
    }
  }, []);

  // Copy all log contents to clipboard
  const handleCopy = useCallback(async () => {
    const plainText = lines
      .map((line) => stripAnsi(line.content))
      .join('\n');

    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }, [lines]);

  const getLineTypeClasses = (type: LogLine['type']): string => {
    switch (type) {
      case 'stderr':
      case 'error':
        return 'text-red-400';
      case 'success':
        return 'text-green-400';
      case 'info':
        return 'text-blue-400';
      default:
        return '';
    }
  };

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

      {/* Log content */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div
          ref={viewportRef}
          className="h-full overflow-auto scrollbar-macos"
          onScroll={handleScroll}
        >
          <div className="p-3 font-mono text-sm leading-relaxed">
            {lines.length === 0 ? (
              <div className="text-gray-500 italic">
                No output yet. Run a command to see results here.
              </div>
            ) : (
              lines.map((line) => (
                <div
                  key={line.id}
                  className={cn(
                    'whitespace-pre-wrap break-all',
                    getLineTypeClasses(line.type)
                  )}
                >
                  {parseAnsiString(line.content).map((segment, i) => (
                    <span
                      key={i}
                      className={cn(segment.classes)}
                    >
                      {segment.text}
                    </span>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Scroll to bottom indicator */}
      {userScrolledUp && lines.length > 0 && (
        <button
          className="absolute bottom-4 right-4 px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md shadow-md hover:bg-primary/90 transition-colors"
          onClick={() => {
            setUserScrolledUp(false);
            if (viewportRef.current) {
              viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
            }
          }}
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}

// Helper to create a log line with unique ID
let lineIdCounter = 0;

export function createLogLine(
  content: string,
  type: LogLine['type'] = 'stdout'
): LogLine {
  return {
    id: `log-${Date.now()}-${lineIdCounter++}`,
    content,
    type,
    timestamp: new Date(),
  };
}
