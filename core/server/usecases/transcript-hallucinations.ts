export interface HallucinationSegment {
  start: number;
  end: number;
  text: string;
  noSpeechProb: number | null;
  avgLogprob: number | null;
}

export interface FilteredTranscript {
  text: string;
  segments: HallucinationSegment[];
}

const MAX_HALLUCINATION_WORDS = 4;
const NO_SPEECH_THRESHOLD = 0.6;
const AVG_LOGPROB_THRESHOLD = -1;

export const hallucinationPhrases: readonly string[] = [
  'thank you',
  'thank you very much',
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'like and subscribe',
  'see you next time',
  'bye',
  'bye bye',
  'dziękuję',
  'dziękuję za uwagę',
  'dziękuję za obejrzenie',
  'dzięki za oglądanie',
  'do zobaczenia',
  'subskrybuj',
];

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const blocklist = new Set(hallucinationPhrases.map(normalize));

const wordCount = (normalized: string): number => (normalized.length === 0 ? 0 : normalized.split(' ').length);

const lowConfidence = (segment: HallucinationSegment): boolean =>
  (segment.noSpeechProb !== null && segment.noSpeechProb >= NO_SPEECH_THRESHOLD) ||
  (segment.avgLogprob !== null && segment.avgLogprob <= AVG_LOGPROB_THRESHOLD);

export const isHallucinatedSegment = (segment: HallucinationSegment, context: { isOnlyContent: boolean }): boolean => {
  const normalized = normalize(segment.text);
  if (!blocklist.has(normalized)) return false;
  if (wordCount(normalized) > MAX_HALLUCINATION_WORDS) return false;
  return context.isOnlyContent || lowConfidence(segment);
};

export const filterHallucinatedSegments = (segments: readonly HallucinationSegment[]): HallucinationSegment[] => {
  const isOnlyContent = segments.length === 1;
  return segments.filter((segment) => !isHallucinatedSegment(segment, { isOnlyContent }));
};

export const filterTranscript = (rawText: string, segments: readonly HallucinationSegment[] | null): FilteredTranscript => {
  if (segments === null || segments.length === 0) {
    const trimmed = rawText.trim();
    const kept = filterHallucinatedSegments([{ start: 0, end: 0, text: trimmed, noSpeechProb: null, avgLogprob: null }]);
    return { text: kept.length === 0 ? '' : rawText, segments: [] };
  }
  const kept = filterHallucinatedSegments(segments);
  if (kept.length === segments.length) return { text: rawText, segments: kept };
  const text = kept
    .map((segment) => segment.text.trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return { text, segments: kept };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const richSegmentFromRaw = (raw: unknown): HallucinationSegment | null => {
  if (!isRecord(raw)) return null;
  const offsets = isRecord(raw.offsets) ? raw.offsets : null;
  const startMs = offsets === null ? null : finiteNumber(offsets.from);
  const endMs = offsets === null ? null : finiteNumber(offsets.to);
  const start = finiteNumber(raw.start) ?? (startMs === null ? null : startMs / 1000);
  const end = finiteNumber(raw.end) ?? (endMs === null ? null : endMs / 1000);
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (start === null || end === null || start < 0 || end <= start || text.length === 0) return null;
  return {
    start,
    end,
    text,
    noSpeechProb: finiteNumber(raw.no_speech_prob),
    avgLogprob: finiteNumber(raw.avg_logprob),
  };
};

const extractRawSegments = (decoded: unknown): unknown[] | null => {
  if (Array.isArray(decoded)) return decoded;
  if (!isRecord(decoded)) return null;
  if (Array.isArray(decoded.segments)) return decoded.segments;
  if (Array.isArray(decoded.transcription)) return decoded.transcription;
  return null;
};

export const parseRichSegments = (decoded: unknown): HallucinationSegment[] | null => {
  const rawSegments = extractRawSegments(decoded);
  if (rawSegments === null) return null;
  const segments: HallucinationSegment[] = [];
  for (const raw of rawSegments) {
    const segment = richSegmentFromRaw(raw);
    if (segment !== null) segments.push(segment);
  }
  return segments.length === 0 ? null : segments;
};
