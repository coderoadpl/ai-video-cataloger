/**
 * Tests for the summary format service
 * The .json file is the machine-readable source of truth;
 * the .txt file is a human-readable rendering of the same data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDir, cleanupTestDir } from './setup.js';
import {
  writeSummary,
  readSummary,
  getSummaryPath,
  getSummaryJsonPath,
  getSummariesDir,
  type SummaryData,
} from '../src/services/summary-format.js';

describe('summary-format', () => {
  let testDir: string;
  let videoPath: string;

  const sampleData: SummaryData = {
    schemaVersion: 1,
    description: 'A cat playing with a ball of yarn on a couch.',
    suggestedFilename: 'cat-playing-with-yarn',
    fullAnalysis: 'DESCRIPTION: A cat playing with a ball of yarn.\nFILENAME: cat-playing-with-yarn',
    analyzedAt: '2026-06-12T10:00:00.000Z',
  };

  beforeEach(() => {
    testDir = createTestDir();
    videoPath = join(testDir, 'test-video.mp4');
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  describe('path helpers', () => {
    it('should derive the .json path from the video path', () => {
      expect(getSummaryJsonPath(videoPath)).toBe(join(testDir, 'summaries', 'test-video.json'));
    });

    it('should derive the .txt path from the video path', () => {
      expect(getSummaryPath(videoPath)).toBe(join(testDir, 'summaries', 'test-video.txt'));
    });
  });

  describe('writeSummary', () => {
    it('should produce both the .json and the .txt files', () => {
      writeSummary(videoPath, sampleData);

      expect(existsSync(getSummaryJsonPath(videoPath))).toBe(true);
      expect(existsSync(getSummaryPath(videoPath))).toBe(true);
    });

    it('should leave no .tmp files behind', () => {
      writeSummary(videoPath, sampleData);

      const files = readdirSync(getSummariesDir(videoPath));
      expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    });

    it('should render the .txt from the same data', () => {
      writeSummary(videoPath, sampleData);

      const txtContent = readFileSync(getSummaryPath(videoPath), 'utf-8');
      expect(txtContent).toContain('DESCRIPTION:');
      expect(txtContent).toContain(sampleData.description);
      expect(txtContent).toContain('SUGGESTED FILENAME:');
      expect(txtContent).toContain(sampleData.suggestedFilename);
      expect(txtContent).toContain('FULL ANALYSIS:');
      expect(txtContent).toContain(sampleData.analyzedAt);
    });
  });

  describe('readSummary', () => {
    it('should roundtrip write/read', () => {
      writeSummary(videoPath, sampleData);

      const result = readSummary(videoPath);
      expect(result).toEqual(sampleData);
    });

    it('should return null when the .json is missing', () => {
      expect(readSummary(videoPath)).toBeNull();
    });

    it('should return null when only the .txt exists (no backward compatibility)', () => {
      mkdirSync(getSummariesDir(videoPath), { recursive: true });
      writeFileSync(getSummaryPath(videoPath), 'DESCRIPTION:\nsome text\n', 'utf-8');

      expect(readSummary(videoPath)).toBeNull();
    });

    it('should return null for a corrupted .json', () => {
      mkdirSync(getSummariesDir(videoPath), { recursive: true });
      writeFileSync(getSummaryJsonPath(videoPath), '{ not valid json', 'utf-8');

      expect(readSummary(videoPath)).toBeNull();
    });

    it('should return null for a wrong schemaVersion', () => {
      mkdirSync(getSummariesDir(videoPath), { recursive: true });
      writeFileSync(
        getSummaryJsonPath(videoPath),
        JSON.stringify({ ...sampleData, schemaVersion: 2 }),
        'utf-8'
      );

      expect(readSummary(videoPath)).toBeNull();
    });

    it('should return null when a required field is missing', () => {
      mkdirSync(getSummariesDir(videoPath), { recursive: true });
      const { suggestedFilename: _omitted, ...incomplete } = sampleData;
      writeFileSync(getSummaryJsonPath(videoPath), JSON.stringify(incomplete), 'utf-8');

      expect(readSummary(videoPath)).toBeNull();
    });

    it('should return null when a field has the wrong type', () => {
      mkdirSync(getSummariesDir(videoPath), { recursive: true });
      writeFileSync(
        getSummaryJsonPath(videoPath),
        JSON.stringify({ ...sampleData, description: 42 }),
        'utf-8'
      );

      expect(readSummary(videoPath)).toBeNull();
    });

    it('should return null for non-object JSON content', () => {
      mkdirSync(getSummariesDir(videoPath), { recursive: true });
      writeFileSync(getSummaryJsonPath(videoPath), '"just a string"', 'utf-8');

      expect(readSummary(videoPath)).toBeNull();
    });
  });
});
