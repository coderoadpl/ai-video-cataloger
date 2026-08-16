export interface AnalysisProvenance {
  readonly label: string;
  readonly createdAt: string;
}

export interface AnalysisProvenanceCopy {
  readonly provider: Readonly<Record<string, string>>;
  readonly language: Readonly<Record<string, string>>;
}

const SEGMENT_SEPARATOR = ' · ';

const titleCaseToken = (token: string): string => token
  .split(/[-_]/)
  .map((segment) => {
    const first = segment[0];
    return first === undefined ? segment : `${first.toLocaleUpperCase()}${segment.slice(1)}`;
  })
  .join(' ');

const namedLabel = (label: string, copy: AnalysisProvenanceCopy): string => {
  const segments = label.split(SEGMENT_SEPARATOR);
  const [providerId, model, outputLanguage] = segments;
  if (segments.length !== 3 || providerId === undefined || model === undefined || outputLanguage === undefined) {
    return label;
  }
  return [
    copy.provider[providerId] ?? titleCaseToken(providerId),
    model,
    copy.language[outputLanguage] ?? outputLanguage,
  ].join(SEGMENT_SEPARATOR);
};

export const analysisProvenanceLine = (
  provenance: AnalysisProvenance,
  copy: AnalysisProvenanceCopy,
  formatTimestamp: (iso: string) => string | null,
): string => {
  const label = namedLabel(provenance.label, copy);
  const timestamp = formatTimestamp(provenance.createdAt);
  return timestamp === null ? label : `${label}${SEGMENT_SEPARATOR}${timestamp}`;
};
