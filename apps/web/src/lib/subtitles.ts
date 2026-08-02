export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export const buildWebVtt = (segments: readonly TranscriptSegment[]): string | null => {
  const cues = segments
    .map((segment) => ({
      start: Math.max(0, segment.start),
      end: Math.max(0, segment.end),
      text: segment.text.trim(),
    }))
    .filter((segment) => segment.text.length > 0 && segment.end > segment.start);

  if (cues.length === 0) return null;
  return `WEBVTT\n\n${cues
    .map((cue, index) => `${index + 1}\n${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${escapeCueText(cue.text)}`)
    .join('\n\n')}\n`;
};

const escapeCueText = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ');

export const formatVttTime = (seconds: number): string => {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const wholeSeconds = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  const safeMillis = millis === 1000 ? 999 : millis;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${wholeSeconds
    .toString()
    .padStart(2, '0')}.${safeMillis.toString().padStart(3, '0')}`;
};
