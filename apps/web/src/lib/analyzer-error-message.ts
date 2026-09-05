export interface AnalyzerErrorMessages {
  analyzerFailed: string;
  analyzerFailedWithCode: (code: number) => string;
  analyzerCommandNotFound: string;
  analyzerCommandNotStarted: string;
  analyzerTimedOut: string;
  analyzerCancelled: string;
  localAiUnavailable: string;
  modelNotInstalled: string;
  providerAuthFailed: string;
  providerRateLimited: string;
  providerTimedOut: string;
  providerRequestFailed: string;
  providerEmptyResponse: string;
  photoResponseInvalid: string;
  rootNotFound: (path: string) => string;
  catalogRootEmpty: string;
}

interface KnownErrorShape {
  pattern: RegExp;
  resolve: (match: RegExpMatchArray, messages: AnalyzerErrorMessages) => string;
}

const KNOWN_ERROR_SHAPES: readonly KnownErrorShape[] = [
  {
    pattern: /^Command failed \(exit code (\d+)\)\.?$/,
    resolve: (match, messages) => messages.analyzerFailedWithCode(Number(match[1])),
  },
  { pattern: /^Command failed[:.]/, resolve: (_match, messages) => messages.analyzerFailed },
  { pattern: /^Command (not found|is not executable)\.?$/, resolve: (_match, messages) => messages.analyzerCommandNotFound },
  { pattern: /^Command could not be started/, resolve: (_match, messages) => messages.analyzerCommandNotStarted },
  { pattern: /^Command timed out(?: after \d+ ms)?\.?$/, resolve: (_match, messages) => messages.analyzerTimedOut },
  { pattern: /^Command cancelled\.?$/, resolve: (_match, messages) => messages.analyzerCancelled },
  {
    pattern: /^Local AI (runtime not reachable|runtime is not available|returned an empty response)/,
    resolve: (_match, messages) => messages.localAiUnavailable,
  },
  { pattern: /^Model not installed:/, resolve: (_match, messages) => messages.modelNotInstalled },
  { pattern: /rejected the stored credential/, resolve: (_match, messages) => messages.providerAuthFailed },
  { pattern: /rate limit reached/i, resolve: (_match, messages) => messages.providerRateLimited },
  { pattern: /^API provider request timed out$/, resolve: (_match, messages) => messages.providerTimedOut },
  { pattern: /^API provider request failed$/, resolve: (_match, messages) => messages.providerRequestFailed },
  { pattern: /returned an empty response$/, resolve: (_match, messages) => messages.providerEmptyResponse },
  {
    pattern: /^Photo batch response (?:did not contain a JSON array|was not valid JSON|did not match the expected element shape|returned \d+ elements, expected \d+|index \d+ is (?:out of range|duplicated))$/,
    resolve: (_match, messages) => messages.photoResponseInvalid,
  },
  { pattern: /^Root not found: (.+)$/, resolve: (match, messages) => messages.rootNotFound(match[1] ?? '') },
  { pattern: /^No catalog folders found under:/, resolve: (_match, messages) => messages.catalogRootEmpty },
];

// Two or more segments, so "and/or" stays prose; never preceded by a word
// character, a slash or a colon, so "https://host/path" stays a whole URL.
const ABSOLUTE_PATH_TOKEN = /(?<![\w:/])(?:\/[^\s'"()[\],;:]+){2,}/g;

const stripAbsolutePaths = (message: string): string =>
  message.replace(ABSOLUTE_PATH_TOKEN, '[…]').trim();

export const formatAnalyzerError = (raw: string, messages: AnalyzerErrorMessages): string => {
  for (const shape of KNOWN_ERROR_SHAPES) {
    const match = raw.match(shape.pattern);
    if (match !== null) return shape.resolve(match, messages);
  }
  return stripAbsolutePaths(raw);
};
