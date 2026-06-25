/**
 * ANSI escape sequence parsing for the terminal log.
 *
 * Extracted from components/terminal-log.tsx so lines can be parsed ONCE at
 * append time (see hooks/use-terminal-log.ts) instead of on every render.
 */

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

export interface AnsiSegment {
  text: string;
  classes: string[];
}

export function parseAnsiString(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  // Match ANSI escape sequences: ESC[ followed by params and ending with 'm'
  // eslint-disable-next-line no-control-regex -- ESC (\x1b) is the point of this regex
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

export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex -- ESC (\x1b) is the point of this regex
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}
