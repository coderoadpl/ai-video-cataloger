import { describe, expect, it } from 'vitest';

import { en, pl } from '../../i18n/dictionary.js';
import { analysisProvenanceText } from './analysis-provenance.js';

const createdAt = '2026-08-10T17:46:06.744Z';

describe('analysisProvenanceText', () => {
  it('renders the en line with a named provider, the verbatim model and a named language', () => {
    const line = analysisProvenanceText({ label: 'local · gemma3:4b · auto', createdAt }, en);
    expect(line).toMatch(/^Local · gemma3:4b · app language \(auto\) · /);
  });

  it('renders the pl line with a named provider, the verbatim model and a named language', () => {
    const line = analysisProvenanceText({ label: 'local · gemma3:4b · auto', createdAt }, pl);
    expect(line).toMatch(/^Lokalny · gemma3:4b · język aplikacji \(auto\) · /);
  });

  it('renders a readable en date instead of the raw ISO timestamp', () => {
    const line = analysisProvenanceText({ label: 'local · gemma3:4b · auto', createdAt }, en);
    expect(line).not.toContain(createdAt);
    expect(line).toContain('Aug');
  });

  it('renders Polish month naming for the pl dictionary', () => {
    const line = analysisProvenanceText({ label: 'local · gemma3:4b · auto', createdAt }, pl);
    expect(line).not.toContain(createdAt);
    expect(line).toContain('sie');
  });

  it('names the api and harness providers', () => {
    expect(analysisProvenanceText({ label: 'api · gpt-5 · en', createdAt }, en)).toMatch(/^API · gpt-5 · English · /);
    expect(analysisProvenanceText({ label: 'harness · sonnet · pl', createdAt }, pl)).toMatch(/^Agent harness · sonnet · polski · /);
  });

  it('uses configured names for built-in provider ids and localizes ISO output languages', () => {
    expect(analysisProvenanceText({ label: 'codex · dir-access · en', createdAt }, en)).toMatch(/^Codex · dir-access · English · /);
    expect(analysisProvenanceText({ label: 'codex · dir-access · en', createdAt }, pl)).toMatch(/^Codex · dir-access · angielski · /);
    expect(analysisProvenanceText({ label: 'claude-code · file-urls · pl', createdAt }, en)).toMatch(/^Claude Code · file-urls · Polish · /);
  });

  it('title-cases unknown providers and passes unknown language tokens through unchanged', () => {
    const line = analysisProvenanceText({ label: 'gemini-native · gemini-2.5 · pt-BR', createdAt }, en);
    expect(line).toMatch(/^Gemini Native · gemini-2\.5 · pt-BR · /);
  });

  it('leaves a label that is not provider/model/language shaped untouched', () => {
    expect(analysisProvenanceText({ label: 'legacy', createdAt }, en)).toMatch(/^legacy · /);
  });
});
