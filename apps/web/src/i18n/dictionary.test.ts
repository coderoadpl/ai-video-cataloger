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
    expect(pl.people.videoFileCount(1)).toBe('1 film');
    expect(pl.people.videoFileCount(2)).toBe('2 filmy');
    expect(pl.people.videoFileCount(5)).toBe('5 filmów');
    expect(pl.people.photoFileCount(1)).toBe('1 zdjęcie');
    expect(pl.people.photoFileCount(3)).toBe('3 zdjęcia');
    expect(pl.people.photoFileCount(5)).toBe('5 zdjęć');
    expect(pl.people.frameObservationCount(1)).toBe('1 wystąpienie');
    expect(pl.people.frameObservationCount(2)).toBe('2 wystąpienia');
    expect(pl.people.frameObservationCount(5)).toBe('5 wystąpień');
    expect(pl.people.reclusterConfirmWithNames(1)).toBe('Przebuduj i usuń 1 imię');
    expect(pl.people.reclusterConfirmWithNames(2)).toBe('Przebuduj i usuń 2 imiona');
    expect(pl.people.reclusterConfirmWithNames(5)).toBe('Przebuduj i usuń 5 imion');
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
    expect(pl.settingsModal.geminiSpendReadout('2026-08', '$1.00', 1)).toContain('w 1 analizie');
    expect(pl.settingsModal.geminiSpendReadout('2026-08', '$1.00', 3)).toContain('w 3 analizach');
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
    expect(en.people.videoFileCount(1)).toBe('1 video');
    expect(en.people.videoFileCount(2)).toBe('2 videos');
    expect(en.people.photoFileCount(1)).toBe('1 photo');
    expect(en.people.photoFileCount(2)).toBe('2 photos');
    expect(en.people.frameObservationCount(1)).toBe('1 occurrence');
    expect(en.people.frameObservationCount(2)).toBe('2 occurrences');
    expect(en.people.reclusterConfirmWithNames(1)).toBe('Rebuild and drop 1 name');
    expect(en.people.reclusterConfirmWithNames(2)).toBe('Rebuild and drop 2 names');
    expect(en.settingsModal.frameCountValue(1)).toBe('1 frame');
    expect(en.settingsModal.frameCountValue(2)).toBe('2 frames');
    expect(en.settingsModal.geminiSpendReadout('2026-08', '$1.00', 1)).toContain('across 1 analysis');
    expect(en.settingsModal.geminiSpendReadout('2026-08', '$1.00', 2)).toContain('across 2 analyses');
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

  it('localizes invalid photo analyzer responses in English and Polish', () => {
    expect(en.errors.photoResponseInvalid).toBe('The analyzer response did not match the expected format. Try again.');
    expect(pl.errors.photoResponseInvalid).toBe('Odpowiedź analizatora nie pasowała do oczekiwanego formatu. Spróbuj ponownie.');
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
    expect(pl.people.mergeBody(2, 'Ala')).toBe('Scal 2 osoby w „Ala”? Pozostałe grupy znikną. Tego nie można cofnąć.');
    expect(pl.people.mergeBody(5, 'Ala')).toBe('Scal 5 osób w „Ala”? Pozostałe grupy znikną. Tego nie można cofnąć.');
    expect(pl.people.mergeSelectHint).toBe('Zaznacz co najmniej dwie osoby.');
  });

  it('names an auto-generated person without a genitive stutter', () => {
    const auto = pl.people.personName(2);
    expect(auto).toBe('Osoba 3');
    expect(pl.people.pairReviewCrop(auto)).toBe('Twarz: Osoba 3');
    expect(pl.people.personSelectionTitle(auto)).toBe('Pliki: Osoba 3');
    expect(pl.people.selectPerson(auto)).toBe('Wybierz: Osoba 3');
  });

  it('asks about the display name, not a first name, when a merge keeps one', () => {
    expect(pl.people.mergeNameChoice).toBe('Którą nazwę zachować?');
    expect(pl.people.displayName).toBe('Nazwa wyświetlana');
    expect(en.people.mergeNameChoice).toBe('Which name should be kept?');
  });

  it('names the pair-review entry point with a verb and a noun', () => {
    expect(pl.people.pairReviewOpen(3, false)).toBe('Sprawdź podobne osoby (3)');
    expect(en.people.pairReviewOpen(3, false)).toBe('Review look-alikes (3)');
    expect(pl.settingsModal.facesPairScopeHelper).toContain('Osoby');
    expect(en.settingsModal.facesPairScopeHelper).toContain('People tab');
  });

  it('marks a capped review queue with a plus instead of the raw candidate count', () => {
    expect(pl.people.pairReviewOpen(200, true)).toBe('Sprawdź podobne osoby (200+)');
    expect(en.people.pairReviewOpen(200, true)).toBe('Review look-alikes (200+)');
  });

  it('says the truncated queue refills as answers come in', () => {
    expect(pl.people.pairReviewTruncated(200)).toContain('200');
    expect(pl.people.pairReviewTruncated(200)).toContain('kolejne');
    expect(en.people.pairReviewTruncated(200)).toContain('200');
    expect(en.people.pairReviewTruncated(200)).toContain('more');
  });

  it('labels the folding threshold as a compact button with its current value', () => {
    expect(pl.people.minObservationButton(10)).toBe('Min. wystąpień: 10');
    expect(en.people.minObservationButton(10)).toBe('Min. observations: 10');
    expect(pl.people.minObservationHint).toContain('Inne');
    expect(en.people.minObservationHint).toContain('Other');
  });

  it('separates the merging wait from the plain saving wait after an answer', () => {
    expect(pl.people.pairReviewMerging).toBe('Scalanie…');
    expect(pl.people.pairReviewSaving).toBe('Zapisywanie…');
    expect(en.people.pairReviewMerging).toBe('Merging…');
    expect(en.people.pairReviewSaving).toBe('Saving…');
  });

  it('promises that switching face grouping off keeps every recognised person', () => {
    expect(pl.settingsModal.facesDisableHelper).toContain('nie usuwa');
    expect(pl.settingsModal.facesDisableHelper).toContain('Osoby');
    expect(en.settingsModal.facesDisableHelper).toContain('keeps');
    expect(en.settingsModal.facesDisableHelper).toContain('People');
  });

  it('says a skipped pair comes back, so Skip does not read as permanent', () => {
    expect(pl.people.pairReviewSkipCaption).toBe('Zapytamy ponownie za 30 dni');
    expect(en.people.pairReviewSkipCaption).toBe('We will ask again in 30 days');
  });

  it('counts the answered questions on the three-form Polish plural', () => {
    expect(pl.people.pairReviewDoneBody(1)).toBe('Odpowiedziano na 1 pytanie.');
    expect(pl.people.pairReviewDoneBody(3)).toBe('Odpowiedziano na 3 pytania.');
    expect(pl.people.pairReviewDoneBody(5)).toBe('Odpowiedziano na 5 pytań.');
    expect(en.people.pairReviewDoneBody(1)).toBe('You answered 1 question.');
    expect(en.people.pairReviewDoneBody(4)).toBe('You answered 4 questions.');
  });

  it('agrees the Polish verb with the count of errored files a batch will not retry', () => {
    expect(pl.batchToolbar.analyzeSkipsErrored(1))
      .toBe('1 nieudany plik nie zostanie ponowiony — otwórz plik i użyj „Analizuj ponownie”.');
    expect(pl.batchToolbar.analyzeSkipsErrored(3))
      .toBe('3 nieudane pliki nie zostaną ponowione — otwórz plik i użyj „Analizuj ponownie”.');
    expect(pl.batchToolbar.analyzeSkipsErrored(5))
      .toBe('5 nieudanych plików nie zostanie ponowionych — otwórz plik i użyj „Analizuj ponownie”.');
    expect(en.batchToolbar.analyzeSkipsErrored(1)).toContain('file is');
    expect(en.batchToolbar.analyzeSkipsErrored(2)).toContain('files are');
  });

  it('describes people grouping as videos and photos in both locales', () => {
    expect(en.people.subtitle).toBe('Local face grouping from analyzed catalog videos and photos.');
    expect(pl.people.subtitle).toBe('Lokalne grupowanie twarzy z przeanalizowanych filmów i zdjęć katalogu.');
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
  it('uses one ellipsis character and Polish quotation marks across both locales', () => {
    for (const dictionary of [en, pl]) {
      for (const value of leafValues(dictionary)) {
        expect(value).not.toContain('...');
        expect(value).not.toContain('\u00ab');
        expect(value).not.toContain('\u00bb');
      }
    }
  });

  it('agrees the Polish verb and adjective in the catalog folder counter', () => {
    expect(pl.catalog.folderCounts(1, 1)).toBe('1 oczekuje · 1 gotowy');
    expect(pl.catalog.folderCounts(2, 2)).toBe('2 oczekują · 2 gotowe');
    expect(pl.catalog.folderCounts(5, 5)).toBe('5 oczekuje · 5 gotowych');
    expect(pl.catalog.folderCounts(22, 22)).toBe('22 oczekują · 22 gotowe');
    expect(pl.catalog.folderCountsWithDuplicates(3, 0, 2)).toBe('3 oczekują · 0 gotowych · 2 duplikaty');
  });

  it('selects the English singular for a one-file collection header', () => {
    expect(en.library.countHeader(0, 0)).toBe('0 files');
    expect(en.library.countHeader(1, 1)).toBe('1 file');
    expect(en.library.countHeader(2, 2)).toBe('2 files');
    expect(en.library.countHeader(1, 2)).toBe('1 of 2 files');
  });

  it('keeps the Polish collection header on the three-form plural', () => {
    expect(pl.library.countHeader(1, 1)).toContain('1 plik');
    expect(pl.library.countHeader(2, 2)).toContain('2 pliki');
    expect(pl.library.countHeader(5, 5)).toContain('5 plików');
    expect(pl.library.countHeader(12, 12)).toContain('12 plików');
    expect(pl.library.countHeader(22, 22)).toContain('22 pliki');
  });

  it('shares one status vocabulary between video and photo badges', () => {
    for (const dictionary of [en, pl]) {
      expect(dictionary.mediaStatus.analyzed.length).toBeGreaterThan(0);
      expect(dictionary.mediaStatus.failed.length).toBeGreaterThan(0);
      expect(dictionary.mediaStatus.pending.length).toBeGreaterThan(0);
    }
  });

  it('describes every implemented map location source in the empty state', () => {
    expect(pl.map.emptyBody).not.toContain('nigdy');
    expect(pl.map.emptyBody).toContain('osi czasu');
    expect(en.map.emptyBody).toContain('timeline');
    expect(en.map.emptyBody).not.toContain('never');
  });
});
