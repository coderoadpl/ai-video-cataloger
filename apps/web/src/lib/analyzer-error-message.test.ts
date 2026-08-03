import { describe, expect, it } from 'vitest';

import { formatAnalyzerError, type AnalyzerErrorMessages } from './analyzer-error-message.js';

const messages: AnalyzerErrorMessages = {
  analyzerFailed: 'Analiza nie powiodła się.',
  analyzerFailedWithCode: (code) => `Analiza nie powiodła się (kod wyjścia ${String(code)}).`,
  analyzerCommandNotFound: 'Nie znaleziono polecenia analizatora.',
  analyzerCommandNotStarted: 'Nie udało się uruchomić polecenia analizatora.',
  analyzerTimedOut: 'Przekroczono limit czasu analizy.',
  analyzerCancelled: 'Analiza została anulowana.',
  localAiUnavailable: 'Lokalny model AI jest niedostępny.',
  modelNotInstalled: 'Wybrany model nie jest zainstalowany.',
  providerAuthFailed: 'Dostawca odrzucił zapisane poświadczenia.',
  providerRateLimited: 'Osiągnięto limit zapytań dostawcy.',
  providerTimedOut: 'Przekroczono czas odpowiedzi dostawcy.',
  providerRequestFailed: 'Żądanie do dostawcy nie powiodło się.',
  providerEmptyResponse: 'Dostawca zwrócił pustą odpowiedź.',
  rootNotFound: (path) => `Nie znaleziono folderu: ${path}`,
};

describe('formatAnalyzerError', () => {
  it('maps the legacy pre-W50 leaked shell path to the localized generic failure message', () => {
    const leaked = 'Command failed: /var/folders/s4/xw5m39vj0bvd7z1v0pcs5ssr0000gn/T/cmux-cli-shims/8DC7FBD3-E6C8-42C3-B012-BECEA9CC11AD/claude';

    const result = formatAnalyzerError(leaked, messages);

    expect(result).toBe(messages.analyzerFailed);
    expect(result).not.toContain('/var/folders');
    expect(result).not.toContain('Command failed');
  });

  it('maps the current exit-code shape and keeps the code', () => {
    expect(formatAnalyzerError('Command failed (exit code 1).', messages)).toBe(
      messages.analyzerFailedWithCode(1),
    );
  });

  it('maps a spawn ENOENT failure to a command-not-found message', () => {
    expect(formatAnalyzerError('Command not found.', messages)).toBe(messages.analyzerCommandNotFound);
  });

  it('maps a command timeout', () => {
    expect(formatAnalyzerError('Command timed out.', messages)).toBe(messages.analyzerTimedOut);
  });

  it('maps an unreachable local runtime that still carries a URL and a raw cause', () => {
    const raw = 'Local AI runtime not reachable at http://127.0.0.1:11434: connect ECONNREFUSED 127.0.0.1:11434';

    expect(formatAnalyzerError(raw, messages)).toBe(messages.localAiUnavailable);
  });

  it('strips an absolute path from an unknown error shape instead of dropping it', () => {
    const raw = 'Could not read /Users/example/Movies/clip.mp4: permission denied';

    const result = formatAnalyzerError(raw, messages);

    expect(result).not.toContain('/Users/example');
    expect(result).toContain('Could not read');
    expect(result).toContain('permission denied');
  });

  it('strips a quoted absolute path, the shape every Node filesystem error uses', () => {
    const raw = "ENOENT: no such file or directory, open '/Users/example/Movies/clip.mp4'";

    const result = formatAnalyzerError(raw, messages);

    expect(result).not.toContain('/Users/example');
    expect(result).toContain('ENOENT');
  });

  it('strips a parenthesised absolute path', () => {
    expect(formatAnalyzerError('Analyzer died (/opt/homebrew/bin/ffmpeg)', messages)).not.toContain('/opt/homebrew');
  });

  it('leaves a URL and a bare slash alone instead of mangling them as paths', () => {
    expect(formatAnalyzerError('Upload to https://api.example.com/v1/videos failed', messages)).toBe(
      'Upload to https://api.example.com/v1/videos failed',
    );
    expect(formatAnalyzerError('Choose video and/or audio', messages)).toBe('Choose video and/or audio');
  });

  it('keeps the user-chosen root path visible when the root itself is missing, localized', () => {
    expect(formatAnalyzerError('Root not found: /a/b', messages)).toBe(messages.rootNotFound('/a/b'));
  });

  it('passes an unknown path-free message through unchanged', () => {
    expect(formatAnalyzerError('No credential stored for provider anthropic', messages)).toBe(
      'No credential stored for provider anthropic',
    );
  });
});
