import { z } from 'zod';

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
  filteredSegments: number;
}

const NO_SPEECH_THRESHOLD = 0.6;
const AVG_LOGPROB_THRESHOLD = -1;

export const reviewedTailHallucinations: readonly string[] = [
  'thank you',
  'thank you very much',
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'like and subscribe',
  'see you next time',
  'goodbye',
  'bye',
  'bye bye',
  'pain',
  'dziękuję',
  'dziękuję bardzo',
  'dziękuję za uwagę',
  'dziękuję za obejrzenie',
  'dziękuję za oglądanie',
  'dzięki za oglądanie',
  'do zobaczenia',
  'subskrybuj',
  'mamo mamo prędko',
];

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tailHallucinations = new Set(reviewedTailHallucinations.map(normalize));

const noSpeechProbable = (segment: HallucinationSegment): boolean =>
  segment.noSpeechProb !== null &&
  segment.noSpeechProb >= NO_SPEECH_THRESHOLD &&
  (segment.avgLogprob === null || segment.avgLogprob <= AVG_LOGPROB_THRESHOLD);

interface TranscriptUnit {
  text: string;
  segmentIndex: number;
}

const sentenceUnits = (text: string, segmentIndex: number): TranscriptUnit[] => {
  const units = text.match(/[^.!?\n]+(?:[.!?]+|(?=\n)|$)/gu) ?? [];
  return units
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0)
    .map((unit) => ({ text: unit, segmentIndex }));
};

const collapseRepetitions = (units: readonly TranscriptUnit[]): { units: TranscriptUnit[]; filtered: number } => {
  const kept: TranscriptUnit[] = [];
  let filtered = 0;
  let index = 0;
  while (index < units.length) {
    const current = units[index];
    if (current === undefined) break;
    const normalized = normalize(current.text);
    let end = index + 1;
    while (end < units.length && normalize(units[end]?.text ?? '') === normalized) end += 1;
    const runLength = end - index;
    if (normalized.length > 0 && runLength >= 3) {
      kept.push(current);
      filtered += runLength - 1;
    } else {
      kept.push(...units.slice(index, end));
    }
    index = end;
  }
  return { units: kept, filtered };
};

const stripTrailingHallucinations = (
  units: readonly TranscriptUnit[],
): { units: TranscriptUnit[]; filtered: number } => {
  let end = units.length;
  while (end > 0 && tailHallucinations.has(normalize(units[end - 1]?.text ?? ''))) end -= 1;
  return { units: units.slice(0, end), filtered: units.length - end };
};

const rebuildSegments = (
  segments: readonly HallucinationSegment[],
  units: readonly TranscriptUnit[],
): HallucinationSegment[] => {
  const textBySegment = new Map<number, string[]>();
  for (const unit of units) {
    const texts = textBySegment.get(unit.segmentIndex) ?? [];
    texts.push(unit.text);
    textBySegment.set(unit.segmentIndex, texts);
  }
  return segments.flatMap((segment, index) => {
    const texts = textBySegment.get(index);
    return texts === undefined ? [] : [{ ...segment, text: texts.join(' ') }];
  });
};

export const filterTranscript = (
  rawText: string,
  segments: readonly HallucinationSegment[] | null,
): FilteredTranscript => {
  const metadataSegments = segments ?? [];
  const speechSegments = metadataSegments.filter((segment) => !noSpeechProbable(segment));
  const noSpeechFiltered = metadataSegments.length - speechSegments.length;
  const sourceUnits = segments === null || segments.length === 0
    ? sentenceUnits(rawText.trim(), 0)
    : speechSegments.flatMap((segment, index) => sentenceUnits(segment.text, index));
  const collapsed = collapseRepetitions(sourceUnits);
  const stripped = stripTrailingHallucinations(collapsed.units);
  const filteredSegments = noSpeechFiltered + collapsed.filtered + stripped.filtered;
  if (filteredSegments === 0) {
    return { text: rawText, segments: [...metadataSegments], filteredSegments: 0 };
  }
  if (segments === null || segments.length === 0) {
    return {
      text: stripped.units.map((unit) => unit.text).join(' '),
      segments: [],
      filteredSegments,
    };
  }
  const filteredSegmentsList = rebuildSegments(speechSegments, stripped.units);
  return {
    text: filteredSegmentsList.map((segment) => segment.text.trim()).filter(Boolean).join('\n'),
    segments: filteredSegmentsList,
    filteredSegments,
  };
};

const finiteNumberSchema = z.number().finite();
const rawSegmentSchema = z.object({
  start: finiteNumberSchema.optional(),
  end: finiteNumberSchema.optional(),
  text: z.string(),
  no_speech_prob: finiteNumberSchema.nullable().optional(),
  avg_logprob: finiteNumberSchema.nullable().optional(),
  offsets: z.object({
    from: finiteNumberSchema,
    to: finiteNumberSchema,
  }).optional(),
}).passthrough();

const decodedSegmentsSchema = z.union([
  z.array(z.unknown()),
  z.object({ segments: z.array(z.unknown()) }).passthrough(),
  z.object({ transcription: z.array(z.unknown()) }).passthrough(),
]).transform((decoded): unknown[] => {
  if (Array.isArray(decoded)) return decoded;
  if ('segments' in decoded && Array.isArray(decoded.segments)) return decoded.segments;
  if ('transcription' in decoded && Array.isArray(decoded.transcription)) return decoded.transcription;
  return [];
});

export const richSegmentFromRaw = (raw: unknown): HallucinationSegment | null => {
  const parsed = rawSegmentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const start = parsed.data.start ?? (parsed.data.offsets === undefined ? null : parsed.data.offsets.from / 1000);
  const end = parsed.data.end ?? (parsed.data.offsets === undefined ? null : parsed.data.offsets.to / 1000);
  const text = parsed.data.text.trim();
  if (start === null || end === null || start < 0 || end <= start || text.length === 0) return null;
  return {
    start,
    end,
    text,
    noSpeechProb: parsed.data.no_speech_prob ?? null,
    avgLogprob: parsed.data.avg_logprob ?? null,
  };
};

export const parseRichSegments = (decoded: unknown): HallucinationSegment[] | null => {
  const parsed = decodedSegmentsSchema.safeParse(decoded);
  if (!parsed.success) return null;
  const segments = parsed.data.flatMap((raw) => {
    const segment = richSegmentFromRaw(raw);
    return segment === null ? [] : [segment];
  });
  return segments.length === 0 ? null : segments;
};
