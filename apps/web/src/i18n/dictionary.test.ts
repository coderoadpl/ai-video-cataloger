import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { en, getDict, pl } from './dictionary.js';

const keyPaths = (value: unknown, prefix = ''): string[] => {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix === '' ? key : `${prefix}.${key}`));
};

const leafValues = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(leafValues);
};

describe('dictionary', () => {
  it('keeps identical key structure across en and pl', () => {
    expect(keyPaths(pl).sort()).toEqual(keyPaths(en).sort());
  });

  it('has no empty strings in either locale', () => {
    for (const dictionary of [en, pl]) {
      for (const value of leafValues(dictionary)) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('applies Polish three-form plural rules to counted copy', () => {
    expect(pl.people.observationCount(1)).toBe('1 obserwacja');
    expect(pl.people.observationCount(3)).toBe('3 obserwacje');
    expect(pl.people.observationCount(5)).toBe('5 obserwacji');
    expect(pl.search.resultCount(1)).toBe('1 wynik');
    expect(pl.search.resultCount(3)).toBe('3 wyniki');
    expect(pl.search.resultCount(5)).toBe('5 wyników');
    expect(pl.settingsModal.frameCountValue(1)).toBe('1 klatka');
    expect(pl.settingsModal.frameCountValue(2)).toBe('2 klatki');
    expect(pl.settingsModal.frameCountValue(5)).toBe('5 klatek');
    expect(pl.settingsModal.frameCountValue(22)).toBe('22 klatki');
    expect(pl.photosSidebar.treeFolderCounts(1, 1)).toBe('1 zdjęcie · 1 przeanalizowane');
    expect(pl.photosSidebar.treeFolderCounts(3, 3)).toBe('3 zdjęcia · 3 przeanalizowane');
    expect(pl.photosSidebar.treeFolderCounts(5, 0)).toBe('5 zdjęć · 0 przeanalizowanych');
    expect(pl.photos.analyzeCompletedWithFailuresLog(1, 2)).toBe(
      'Analiza zdjęć zakończona: 1 przeanalizowane zdjęcie, 2 nieudane zdjęcia',
    );
    expect(pl.photos.analyzeCompletedWithFailuresLog(5, 1)).toBe(
      'Analiza zdjęć zakończona: 5 przeanalizowanych zdjęć, 1 nieudane zdjęcie',
    );
    expect(pl.photos.analyzeAllFailedLog(5)).toBe(
      'Analiza zdjęć nie powiodła się: 5 nieudanych zdjęć',
    );
    expect(pl.settingsModal.geminiSpendReadout('2026-08', 1, 1)).toContain('w 1 analizie');
    expect(pl.settingsModal.geminiSpendReadout('2026-08', 1, 3)).toContain('w 3 analizach');
    expect(pl.batchSummary.successful(1)).toBe('udany film');
    expect(pl.batchSummary.successful(3)).toBe('udane filmy');
    expect(pl.batchSummary.failed(5)).toBe('nieudanych filmów');
    expect(pl.batchSummary.duplicatesSkipped(1)).toBe('pominięty duplikat');
    expect(pl.driveSummary.folders(1)).toBe('folder');
    expect(pl.driveSummary.folders(3)).toBe('foldery');
    expect(pl.driveSummary.analyzed(1)).toBe('przeanalizowany plik');
    expect(pl.driveSummary.skipped(3)).toBe('pominięte pliki');
    expect(pl.driveSummary.failed(5)).toBe('nieudanych plików');
    expect(pl.driveSummary.estimatedCost(1)).toBe('szacowany koszt Gemini · 1 wyceniony plik');
    expect(pl.driveSummary.estimatedCost(3)).toBe('szacowany koszt Gemini · 3 wycenione pliki');
    expect(pl.map.clusterLabel(2)).toBe('2 pliki w tym obszarze');
    expect(pl.map.clusterLabel(5)).toBe('5 plików w tym obszarze');
    expect(pl.photos.duplicatesBadge(2)).toBe('2 kopie');
    expect(pl.photos.duplicatesBadge(5)).toBe('5 kopii');
    expect(pl.catalog.largeRunWarningBody(2002).startsWith('Znaleziono 2002 filmy.')).toBe(true);
    expect(pl.catalog.largeRunWarningBody(2005).startsWith('Znaleziono 2005 filmów.')).toBe(true);
    expect(pl.processing.driveRunStarted(1, 2)).toBe('Skanowanie: 1 folder, 2 pliki…');
    expect(pl.processing.driveFolderStarted('/media', 1)).toBe('→ /media (1 plik)');
    expect(pl.processing.driveFolderDone('/media', 1, 2, 3, 5))
      .toBe('✓ /media: 1 gotowy, 2 pominięte (3 duplikaty), 5 nieudanych');
    expect(pl.processing.driveBatchSubmitted(1, false)).toContain('1 plik za pół ceny');
    expect(pl.processing.driveBatchSubmitted(2, true)).toContain('dla 2 plików');
    expect(pl.processing.driveBatchPoll('ACTIVE', 3)).toContain('(3 pliki)');
    expect(pl.processing.driveBatchWaiting(5)).toContain('(5 plików)');
    expect(pl.processing.batchStart(1)).toContain('1 filmu');
  });

  it('uses English singular/plural siblings for counted copy', () => {
    expect(en.search.resultCount(1)).toBe('1 result');
    expect(en.search.resultCount(2)).toBe('2 results');
    expect(en.people.observationCount(1)).toBe('1 observation');
    expect(en.people.observationCount(2)).toBe('2 observations');
    expect(en.settingsModal.frameCountValue(1)).toBe('1 frame');
    expect(en.settingsModal.frameCountValue(2)).toBe('2 frames');
    expect(en.settingsModal.geminiSpendReadout('2026-08', 1, 1)).toContain('across 1 analysis');
    expect(en.settingsModal.geminiSpendReadout('2026-08', 1, 2)).toContain('across 2 analyses');
    expect(en.batchSummary.successful(1)).toBe('successful video');
    expect(en.batchSummary.successful(2)).toBe('successful videos');
    expect(en.driveSummary.folders(1)).toBe('folder');
    expect(en.driveSummary.folders(2)).toBe('folders');
    expect(en.driveSummary.analyzed(1)).toBe('analyzed file');
    expect(en.driveSummary.analyzed(2)).toBe('analyzed files');
    expect(en.driveSummary.estimatedCost(1)).toBe('estimated Gemini cost · 1 priced file');
    expect(en.driveSummary.estimatedCost(2)).toBe('estimated Gemini cost · 2 priced files');
  });

  it('resolves the polish dictionary only for the pl locale', () => {
    expect(getDict('pl')).toBe(pl);
    expect(getDict('en')).toBe(en);
  });

  it('keeps the Polish settings polish copy idiomatic', () => {
    expect(pl.settingsModal.transcriptionLanguage).toBe('Język transkrypcji');
    expect(pl.settingsModal.analyzerTimeoutHelper)
      .toBe('Jak długo czekać na analizator AI, zanim zostanie przerwany.');
    expect(pl.credentials.savedKeychain).toBe('Klucz API zapisano w pęku kluczy macOS.');
    expect(pl.details.variants.configuredLabel(
      'gemini-3.6-flash',
      pl.details.variants.nativeTranscription,
      pl.details.variants.noFrames,
    )).toBe('gemini-3.6-flash - transkrypcja natywna - bez klatek');
    expect(pl.details.variants.frameExtractionDisabled).toBe('Ten wariant nie wyodrębnia klatek');
    expect(en.language.optionAuto).toBe('Automatic (follows the app language)');
    expect(pl.language.optionAuto).toBe('Automatycznie (język aplikacji)');
    expect(en.details.status.analyzing).toBe('Video is being analyzed…');
    expect(pl.details.status.analyzing).toBe('Film jest analizowany…');
    expect(en.readinessNotice.title).toBe('Analysis setup is incomplete');
    expect(pl.readinessNotice.title).toBe('Konfiguracja analizy jest niepełna');
    expect(pl.cancelDialog.continueProcessing).toBe('Kontynuuj analizę');
    expect(pl.people.mergeBody('A', 'B')).toBe('Włączyć A do B? Grupa A zniknie. Tego nie można cofnąć.');
  });

  it('keeps swept UI literals inside the dictionary', () => {
    const literals = ['Search catalog', 'Analyze All', 'Getting Started', 'Only this folder', 'Not detected', 'Open Folder', 'Not Tracked', 'Local (Whisper.cpp)', 'Skip Transcription', 'No output yet. Run an analysis to see job progress here.'];
    const standaloneSaved = /(?<![A-Za-z])Saved(?![A-Za-z])/;

    const srcRoot = join(import.meta.dirname, '..');
    const violations: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        if (fullPath.includes(`${join('src', 'i18n')}`)) continue;
        if (fullPath.includes(`${join('src', 'gallery')}`)) continue;
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const content = readFileSync(fullPath, 'utf8');
        for (const literal of literals) {
          if (content.includes(literal)) violations.push(`${fullPath}: ${literal}`);
        }
        if (standaloneSaved.test(content)) violations.push(`${fullPath}: Saved`);
      }
    };

    walk(srcRoot);

    expect(violations).toEqual([]);
  });
});
