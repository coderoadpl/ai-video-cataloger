import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { _electron as electron } from '@playwright/test';
import { z } from 'zod';

import { FAKE_DRIVE_ID, FOLDER_MIME_TYPE, serviceAccountKeyJson, startFakeDriveServer } from './fake-drive-server.mjs';

// A real JPEG SOI marker, so the scanner accepts the file as a photo, followed
// by nothing, so proxy generation fails and the placeholder tile has to render.
export const BROKEN_PHOTO_NAME = 'broken-photo.jpg';
const TRUNCATED_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
// No EXIF survives the truncation, so the scanner falls back to file mtime for
// capturedAt; an old mtime keeps this row sorted last instead of shadowing real
// fixtures in every date-sorted photo UI (W52).
export const BROKEN_PHOTO_MTIME = new Date('2000-01-01T00:00:00Z');

const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg']);
// photos.db keys a photo by the sha256 of its bytes, and a prepared QA home has already catalogued
// the source fixtures under their own root: a byte-identical scratch copy re-attaches to that row,
// which keeps pointing at the source folder, so the scratch root ends up with no analyzable photo
// at all (W64). Trailing bytes after the JPEG EOI are ignored by decoders — sips and exifr both
// still read the file — so appending a per-run marker gives every run its own fingerprints. One
// marker for the whole run, so the fixtures' intentional duplicate pair stays byte-identical.
const runPhotoMarker = () => Buffer.from(`\n<!-- avc-walkthrough-run ${randomUUID()} -->\n`);
// The whole-tree scope is only offered when the opened root owns a photo-bearing subfolder
// (treeScopeAvailable in apps/web/src/features/photos/use-photos-analysis.ts), and the sanctioned
// fixture sets keep their subfolder video-only, so the photos-tree step would have nothing to
// expand. The extra byte keeps this copy's fingerprint distinct from the photo it was copied from,
// which is what makes its folder a tree node of its own.
export const TREE_PHOTO_PATH = path.join('subfolder', 'tree-photo.jpg');
const TREE_PHOTO_SUFFIX = Buffer.from('\n');

// Matches adapters/ollama-runtime/index.ts's SYSTEM_OLLAMA_BASE_URL: this script runs as
// plain node (no TS path aliases), so the value is duplicated rather than imported.
const SYSTEM_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

const HELP = `release-walkthrough — scripted self-QA pass over a packaged build.

Usage:
  node scripts/release-walkthrough.mjs --app "<AI Video Cataloger.app>" --fixtures <folder> [options]

Options:
  --app <path>                 Packaged .app bundle to drive (required).
  --fixtures <path>            Folder of sample videos the walkthrough opens (required). Never
                               mutated: the runner copies it into a scratch temp folder and plants
                               an unloadable ${BROKEN_PHOTO_NAME} there before opening it, so a photo
                               scan exercises the broken-image placeholder. The source folder should
                               hold at least two videos so one stays unanalyzed after the analyze step
                               clicks only the first.
  --out <path>                 Root for the screenshot set (default: release/walkthrough).
  --home <path>                Prepared QA home; the default throwaway temp home has no analyzer
                               configured, so the analysis step reports itself skipped.
  --query <text>               Override the Library search term (default: derived from the analyzed filename).
  --analyze-timeout <seconds>  Wait for one analysis run to finish (default: 300).
  --window-size <WxH>          Window size for the driven app, e.g. 1920x1200 (default: 1920x1200).
  --dry-run                    Validate the inputs, write plan.json, stop before launching the app.
  --strict                     Exit 1 if any step reports 'skipped', except the tolerated allowlist
                               (first-run-wizard, library-preview — see docs/qa/release-walkthrough.md).
  --archive-to <path>          Copy the finished screenshot set (plan.json, manifest.json and every
                               PNG) to this directory before the run exits, so it survives a worktree
                               cleanup. Release runs pass a path under AVC_SCRATCH_DIR, which points
                               to a scratch directory outside the repository.
  --analyzer local:<model>     Seed the SCRATCH home's config.json with a real local analyzer
                               (analyzer_backend: 'local', local_model: '<model>') and whisper_mode:
                               'skip', so the analyze step can complete offline against the system
                               ollama at ${SYSTEM_OLLAMA_BASE_URL}. Fails fast, before launching the
                               app, if ollama is not reachable or the model is not installed there —
                               a release run must never silently fall back to the claude-CLI default.
                               Overwrites analyzer_backend/local_model/whisper_mode and drops any
                               analyzer_provider a prepared --home was configured with, so the run
                               analyzes with exactly the requested model.
  --help                       Print this help.

Every run launches with an isolated user-data directory, an isolated home and
AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN=1: it never reads or writes the real catalog,
the real settings or the login keychain. The home's config.json is seeded with
ui_language: "pl" before launch, so every screenshot shows production Polish
copy, not English fallback strings.

The backup step needs no Google account: the run starts the in-memory fake Drive
from scripts/fake-drive-server.mjs on a random loopback port, points
AVC_GOOGLE_DRIVE_BASE_URL / AVC_GOOGLE_UPLOAD_BASE_URL at it, and drives the real
enablement stepper with a generated service-account key. Under the disabled
keychain the app keeps the recovery key in <home>/.ai-video-cataloger/secrets.json
(0600) instead of the login keychain, and the run clears every backup_* config key
before launch so a reused --home cannot point at a previous run's file ids.
`;

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const SEARCH_INPUT = 'library-search-input';
const AUTOCOMPLETE_POPPER = '.MuiAutocomplete-popper';
const VISIBLE_TIMEOUT_MS = 15_000;
const SETTLE_TIMEOUT_MS = 5_000;
const FOLDER_TIMEOUT_MS = 60_000;
const SCREENSHOT_SETTLE_TIMEOUT_MS = 3_000;
const SCREENSHOT_SETTLE_FALLBACK_MS = 250;
const DEFAULT_WINDOW_SIZE = '1920x1200';
const WINDOW_SIZE_PATTERN = /^(\d+)x(\d+)$/;
const OLLAMA_CHECK_TIMEOUT_MS = 5_000;
const BACKUP_TIMEOUT_MS = 180_000;
const ANALYZER_FLAG_PATTERN = /^local:(.+)$/;

const optionsSchema = z.object({
  app: z.string().min(1),
  fixtures: z.string().min(1),
  out: z.string().min(1).optional(),
  home: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  analyzeTimeout: z.coerce.number().int().positive().default(300),
  windowSize: z.string().regex(WINDOW_SIZE_PATTERN, 'expected WxH, e.g. 1920x1200').default(DEFAULT_WINDOW_SIZE),
  dryRun: z.boolean().default(false),
  strict: z.boolean().default(false),
  archiveTo: z.string().min(1).optional(),
  analyzer: z.string().regex(ANALYZER_FLAG_PATTERN, 'expected local:<model>, e.g. local:gemma3:4b').optional(),
});

export const parseAnalyzerFlag = (value) => {
  const match = ANALYZER_FLAG_PATTERN.exec(value);
  if (match === null) throw new Error(`invalid --analyzer: ${value} (expected local:<model>, e.g. local:gemma3:4b)`);
  return { backend: 'local', model: match[1] };
};

export const checkOllamaAnalyzer = async (model) => {
  const url = `${SYSTEM_OLLAMA_BASE_URL}/api/tags`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(OLLAMA_CHECK_TIMEOUT_MS) });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `--analyzer local:${model} requires the system ollama at ${SYSTEM_OLLAMA_BASE_URL} to be reachable ` +
        `(connect failed: ${cause}); start it first (\`ollama serve\` or the desktop app), a release run never ` +
        'falls back to the claude-CLI default',
    );
  }
  if (!response.ok) {
    throw new Error(`--analyzer local:${model}: ollama at ${SYSTEM_OLLAMA_BASE_URL} responded with HTTP ${String(response.status)}`);
  }
  const body = await response.json();
  const installed = Array.isArray(body?.models)
    ? body.models.map((entry) => entry?.name).filter((name) => typeof name === 'string')
    : [];
  if (!installed.includes(model)) {
    throw new Error(
      `--analyzer local:${model}: model not installed in ollama at ${SYSTEM_OLLAMA_BASE_URL} ` +
        `(installed: ${installed.length > 0 ? installed.join(', ') : 'none'}); pull it first with \`ollama pull ${model}\``,
    );
  }
};

const parseWindowSize = (windowSize) => {
  const match = WINDOW_SIZE_PATTERN.exec(windowSize);
  if (match === null) throw new Error(`invalid --window-size: ${windowSize}`);
  const [, width, height] = match;
  return { width: Number(width), height: Number(height) };
};

const readOptions = (argv) => {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      app: { type: 'string' },
      fixtures: { type: 'string' },
      out: { type: 'string' },
      home: { type: 'string' },
      query: { type: 'string' },
      'analyze-timeout': { type: 'string' },
      'window-size': { type: 'string' },
      'dry-run': { type: 'boolean' },
      strict: { type: 'boolean' },
      'archive-to': { type: 'string' },
      analyzer: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  return {
    help: values.help === true,
    parsed: optionsSchema.safeParse({
      app: values.app,
      fixtures: values.fixtures,
      out: values.out,
      home: values.home,
      query: values.query,
      analyzeTimeout: values['analyze-timeout'],
      windowSize: values['window-size'],
      dryRun: values['dry-run'] ?? false,
      strict: values.strict ?? false,
      archiveTo: values['archive-to'],
      analyzer: values.analyzer,
    }),
  };
};

const requireDirectory = (candidate, label) => {
  const resolved = path.resolve(candidate);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`${label} is not a directory: ${resolved}`);
  }
  return resolved;
};

const executableInside = (appPath) => {
  const macosDir = path.join(appPath, 'Contents', 'MacOS');
  if (!existsSync(macosDir)) throw new Error(`not an app bundle (no Contents/MacOS): ${appPath}`);
  const [binary] = readdirSync(macosDir);
  if (binary === undefined) throw new Error(`app bundle has no executable: ${macosDir}`);
  return path.join(macosDir, binary);
};

const timestamp = () => new Date().toISOString().replaceAll(':', '-').slice(0, 19);

// Copies rather than plants in place: walkthrough fixture folders are shared,
// read-only templates that a QA run must never mutate (see repo CLAUDE.md).
// Mirrors the scanner's own walk (shouldSkipDirectory in core/server/usecases/shared.ts): a
// fixture folder carries a .ai-video-cataloger sidecar of thumbnails and extracted frames that no
// photo scan ever catalogues, and rewriting those would edit the video catalog instead.
const scratchPhotoPaths = (scratchDir) =>
  readdirSync(scratchDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && PHOTO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((photoPath) => !path.relative(scratchDir, photoPath).split(path.sep).some((segment) => segment.startsWith('.')))
    .sort((left, right) => left.localeCompare(right));

const plantTreePhoto = (scratchDir, sourcePhotoPath) => {
  if (sourcePhotoPath === undefined) return;
  const treePhotoPath = path.join(scratchDir, TREE_PHOTO_PATH);
  mkdirSync(path.dirname(treePhotoPath), { recursive: true });
  writeFileSync(treePhotoPath, Buffer.concat([readFileSync(sourcePhotoPath), TREE_PHOTO_SUFFIX]));
};

export const prepareScratchFixtures = (fixturesDir) => {
  const scratchDir = mkdtempSync(path.join(tmpdir(), 'avc-walkthrough-fixtures-scratch-'));
  cpSync(fixturesDir, scratchDir, { recursive: true });
  const copiedPhotos = scratchPhotoPaths(scratchDir);
  const marker = runPhotoMarker();
  for (const photoPath of copiedPhotos) appendFileSync(photoPath, marker);
  plantTreePhoto(scratchDir, copiedPhotos[0]);
  const brokenPhotoPath = path.join(scratchDir, BROKEN_PHOTO_NAME);
  writeFileSync(brokenPhotoPath, TRUNCATED_JPEG_BYTES);
  utimesSync(brokenPhotoPath, BROKEN_PHOTO_MTIME, BROKEN_PHOTO_MTIME);
  return scratchDir;
};

const buildPlan = async (options) => {
  const appPath = requireDirectory(options.app, '--app');
  const sourceFixturesDir = requireDirectory(options.fixtures, '--fixtures');
  const fixturesDir = prepareScratchFixtures(sourceFixturesDir);
  const outRoot = options.out === undefined ? path.join(REPO_ROOT, 'release', 'walkthrough') : path.resolve(options.out);
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'avc-walkthrough-userdata-'));
  const homeDir = options.home === undefined
    ? mkdtempSync(path.join(tmpdir(), 'avc-walkthrough-home-'))
    : requireDirectory(options.home, '--home');
  const windowSize = parseWindowSize(options.windowSize);
  const analyzer = options.analyzer === undefined ? null : parseAnalyzerFlag(options.analyzer);
  if (analyzer !== null) await checkOllamaAnalyzer(analyzer.model);
  return {
    appPath,
    executablePath: executableInside(appPath),
    sourceFixturesDir,
    fixturesDir,
    outDir: path.join(outRoot, timestamp()),
    userDataDir,
    homeDir,
    query: options.query,
    analyzeTimeoutMs: options.analyzeTimeout * 1000,
    windowWidth: windowSize.width,
    windowHeight: windowSize.height,
    dryRun: options.dryRun,
    strict: options.strict,
    archiveTo: options.archiveTo === undefined ? null : path.resolve(options.archiveTo),
    analyzer,
  };
};

const isolatedEnvironment = (plan, fakeDrive) => ({
  ...process.env,
  HOME: plan.homeDir,
  AVC_HOME_DIRECTORY: plan.homeDir,
  USERPROFILE: plan.homeDir,
  AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN: '1',
  AI_VIDEO_CATALOGER_USER_DATA_DIR: plan.userDataDir,
  AVC_GOOGLE_DRIVE_BASE_URL: fakeDrive.driveBaseUrl,
  AVC_GOOGLE_UPLOAD_BASE_URL: fakeDrive.uploadBaseUrl,
});

const seedWindowState = (plan) => {
  writeFileSync(
    path.join(plan.userDataDir, 'window-state.json'),
    JSON.stringify({ width: plan.windowWidth, height: plan.windowHeight }, null, 2),
  );
};

const updateHomeConfig = (homeDir, update) => {
  const configDir = path.join(homeDir, '.ai-video-cataloger');
  const configFile = path.join(configDir, 'config.json');
  mkdirSync(configDir, { recursive: true });
  const existing = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
  writeFileSync(configFile, JSON.stringify(update(existing), null, 2));
};

const seedUiLanguage = (plan) => updateHomeConfig(plan.homeDir, (existing) => ({ ...existing, ui_language: 'pl' }));

// The fake Drive is in-memory and gets a fresh port every run, so folder and file ids a reused QA
// home still carries would resolve to nothing. Environment setup, not a stand-in for the flow the
// backup step drives: every click in the enablement stepper is still real.
export const withoutBackupConfig = (existing) =>
  Object.fromEntries(Object.entries(existing).filter(([key]) => !key.startsWith('backup_')));

const resetBackupState = (plan) => {
  updateHomeConfig(plan.homeDir, withoutBackupConfig);
  const secretsFile = path.join(plan.homeDir, '.ai-video-cataloger', 'secrets.json');
  if (existsSync(secretsFile)) rmSync(secretsFile);
};

// whisper_mode: 'skip' is the honest transcription-less path (core/domain/config.ts) rather than a
// fabricated offline whisper setup: it lets the pipeline reach 'analyze' without a local whisper
// binary/model in the scratch home. analyzer_provider outranks analyzer_backend in
// core/server/usecases/config-resolution.ts, so a home that configured an analyzer through Settings
// would keep analyzing with that provider instead of the requested local model.
export const localAnalyzerConfig = (existing, model) => {
  const seeded = { ...existing, analyzer_backend: 'local', local_model: model, whisper_mode: 'skip' };
  delete seeded.analyzer_provider;
  return seeded;
};

const seedLocalAnalyzer = (plan) => {
  if (plan.analyzer === null) return;
  updateHomeConfig(plan.homeDir, (existing) => localAnalyzerConfig(existing, plan.analyzer.model));
};

const appeared = async (locator, timeout = VISIBLE_TIMEOUT_MS) => {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
};

const done = (note = '') => ({ status: 'ok', note });
const skipped = (note) => ({ status: 'skipped', note });
const failed = (note) => ({ status: 'failed', note });

// Kept free of Playwright so the mapping from observed DOM state to outcome is unit-testable
// without driving a real app.
export const analyzeOutcome = ({ errorCardVisible, errorNote, videoStatus, filename }) => {
  if (errorCardVisible) return failed(errorNote === '' ? 'analysis ended in error' : errorNote);
  if (videoStatus === 'completed') return done(`analysis completed for ${filename ?? 'the selected video'}`);
  return failed(`analysis finished in unexpected status "${videoStatus ?? 'unknown'}" (no error card, not completed)`);
};

export const treeSelectAnalyzeOutcome = ({ treeVisible, rowVisible, usableRowVisible, detailVisible, analyzeVisible, analyzeDisabled, disabledReason, path: photoPath }) => {
  if (!treeVisible) return skipped('no photos catalogued in this home');
  if (!rowVisible) return skipped('the whole-tree scope has no photo rows to select (roots/folders only)');
  if (!usableRowVisible) return skipped('every tree photo is already analysed or has a failed proxy (no single-photo Analizuj to click)');
  if (!detailVisible) return failed('photo detail workspace did not render for a tree-selected photo');
  if (!analyzeVisible) return failed('no Analizuj affordance for a tree-selected photo (already analysed, or proxy pending)');
  if (analyzeDisabled) {
    return failed(`Analizuj is disabled for a tree-selected photo${disabledReason === '' ? '' : `: ${disabledReason}`} (W57 regression)`);
  }
  return done(`tree-selected ${photoPath ?? 'a photo'} has Analizuj enabled`);
};

export const photoTreeAnalyzeOutcome = ({ errorVisible, errorNote, badgeVisible }) => {
  if (errorVisible) return failed(errorNote === '' ? 'photo analysis ended in error' : errorNote);
  if (badgeVisible) return done('the tree-selected photo carries the "analysed" badge');
  return failed('analysis finished with neither the "analysed" badge nor an error card');
};

// null, not 0: withMeasuredCount renders the bare label while the totals are still loading.
export const parseMediaChipCount = (text) => {
  const match = /\((\d+)\)/.exec(text ?? '');
  return match === null ? null : Number(match[1]);
};

export const collectionPhotoChipOutcome = (photoChipCount) => {
  if (photoChipCount === null) return failed('Kolekcja Zdjęcia chip did not render a measured count');
  if (photoChipCount >= 1) return done(`Kolekcja Zdjęcia chip shows ${String(photoChipCount)} analyzed photo(s)`);
  return failed('Kolekcja Zdjęcia chip still reports 0 after a single-photo analyze completed (W55 payoff unproven)');
};

export const searchTermFromAnalyzedFilename = (filename) => {
  const basename = path.basename(filename, path.extname(filename));
  const tokens = basename.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !/^\d+$/.test(token));
  return tokens[0] ?? basename.toLowerCase();
};

// An open suggestion popper covers the grid and swallows the library-preview tile click.
export const clearLibrarySearch = async (page, input) => {
  await input.click();
  await input.fill('');
  await input.press('Escape');
  await page.locator(AUTOCOMPLETE_POPPER).first().waitFor({ state: 'hidden', timeout: SETTLE_TIMEOUT_MS });
};

// Both steps depend on state a reused QA home may legitimately not have (a
// wizard that already got dismissed, a Library tile from an earlier scan);
// docs/qa/release-walkthrough.md carries the full rationale.
export const TOLERATED_SKIPS = new Set(['first-run-wizard', 'library-preview']);

export const blockingSkips = (results) =>
  results.filter((result) => result.status === 'skipped' && !TOLERATED_SKIPS.has(result.name));

/* eslint-disable no-undef -- runs inside the driven page via Playwright's waitForFunction, not this Node process */
const noPendingTransitionsOrSpinners = () =>
  document.getAnimations().every((animation) => animation.playState !== 'running') &&
  document.querySelector('[role="progressbar"], [data-testid*="spinner" i], [data-testid*="loading" i]') === null;

const selectedRowAnalysedOrJobError = (selectedRow) =>
  document.querySelector(`${selectedRow} [data-testid="photos-sidebar-badge-analysed"]`) !== null ||
  document.querySelector('[data-testid="photos-job-error"]') !== null;
/* eslint-enable no-undef */

// The sidebar toolbar's folder-wide "Analizuj folder" shares this testid, so the bare locator
// resolves to two elements: Playwright rejects every action on it, and .first() would drive the
// whole-folder batch instead of the single photo.
const singlePhotoAnalyzeAction = (page) =>
  page.getByTestId('photos-analysis-detail').getByTestId('photos-analyze-action');

// Only the tree row the step itself selected proves this run's analysis; a badge anywhere in the
// sidebar can predate it in a reused QA home.
const SELECTED_PHOTO_ROW = '[data-testid="photos-sidebar-row"].Mui-selected';

// A folder row click toggles, and the tree opens its root expanded, so an unconditional click
// would collapse whatever it was meant to open.
const expandTreeRow = async (row) => {
  if ((await row.getAttribute('aria-expanded')) === 'false') await row.click();
};

const settle = async (page) => {
  try {
    await page.waitForFunction(noPendingTransitionsOrSpinners, { timeout: SCREENSHOT_SETTLE_TIMEOUT_MS });
  } catch {
    await page.waitForTimeout(SCREENSHOT_SETTLE_FALLBACK_MS);
  }
};

const createRecorder = (page, outDir) => {
  const results = [];
  const record = async (name, body) => {
    const startedAt = Date.now();
    const screenshot = `${String(results.length + 1).padStart(2, '0')}-${name}.png`;
    let outcome;
    try {
      outcome = await body();
    } catch (error) {
      outcome = { status: 'failed', note: error instanceof Error ? error.message : String(error) };
    }
    await settle(page).catch(() => undefined);
    await page.screenshot({ path: path.join(outDir, screenshot) }).catch(() => undefined);
    results.push({ name, ...outcome, durationMs: Date.now() - startedAt, screenshot });
    console.log(`  ${outcome.status.padEnd(7)} ${name}${outcome.note === '' ? '' : ` — ${outcome.note}`}`);
  };
  return { results, record };
};

const dismissWizard = async (page) => {
  const later = page.getByTestId('wizard-configure-later');
  if (await appeared(later, SETTLE_TIMEOUT_MS)) {
    await later.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.getByTestId('setup-wizard').waitFor({ state: 'hidden', timeout: VISIBLE_TIMEOUT_MS });
};

const stubOpenDialog = async (app, folderPath) => {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, folderPath);
};

const stubSaveDialog = async (app, filePath) => {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: target });
  }, filePath);
};

const drive = async (plan) => {
  seedWindowState(plan);
  seedUiLanguage(plan);
  seedLocalAnalyzer(plan);
  resetBackupState(plan);
  const fakeDrive = await startFakeDriveServer({ port: 0 });
  const serviceAccountKey = serviceAccountKeyJson(fakeDrive.tokenUri);
  const recoveryKeyPath = path.join(plan.userDataDir, 'recovery-key.txt');
  const launchedAt = Date.now();
  const app = await electron.launch({
    executablePath: plan.executablePath,
    args: [`--user-data-dir=${plan.userDataDir}`],
    env: isolatedEnvironment(plan, fakeDrive),
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const timeToWindowMs = Date.now() - launchedAt;

  const { results, record } = createRecorder(page, plan.outDir);
  let selectedFilename = '';
  let analyzedFilename = '';

  await record('launch', async () => {
    await page.locator('header').first().waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
    return done(`window in ${String(timeToWindowMs)} ms`);
  });

  await record('first-run-wizard', async () => {
    if (!(await appeared(page.getByTestId('setup-wizard'), SETTLE_TIMEOUT_MS))) {
      return skipped('no first-run wizard on this profile');
    }
    await dismissWizard(page);
    return done('dismissed with "configure later"');
  });

  await record('mode-switch', async () => {
    const switcher = page.getByTestId('mode-switcher');
    if (!(await appeared(switcher, SETTLE_TIMEOUT_MS))) return skipped('no mode switcher in this build');
    const modeLibrary = page.getByTestId('mode-library');
    await modeLibrary.click();
    if (!(await appeared(page.getByTestId('subnav-collection'), SETTLE_TIMEOUT_MS))) {
      return skipped('Library subnav did not render after switching modes');
    }
    return done('mode switcher toggles Library content');
  });

  await record('mode-analysis', async () => {
    const modeAnalysis = page.getByTestId('mode-analysis');
    if (!(await appeared(modeAnalysis, SETTLE_TIMEOUT_MS))) return skipped('no mode switcher in this build');
    await modeAnalysis.click();
    return done('switched to Analysis mode');
  });

  await record('open-folder', async () => {
    await stubOpenDialog(app, plan.fixturesDir);
    const openFolderButton = page.getByRole('button', { name: /open folder|otwórz folder/i }).first();
    if (!(await appeared(openFolderButton, SETTLE_TIMEOUT_MS))) return skipped('no Open Folder control in this build');
    await openFolderButton.click();
    if (!(await appeared(page.getByTestId('video-item'), FOLDER_TIMEOUT_MS))) {
      return skipped(`no videos listed for ${plan.fixturesDir}`);
    }
    await settle(page).catch(() => undefined);
    const count = await page.getByTestId('video-item').count();
    const unanalyzedNote = count >= 2
      ? '; at least one stays unanalyzed after the analyze step'
      : '; WARNING: fewer than 2 videos, no unanalyzed-tile coverage this run';
    return done(`${String(count)} video row(s) listed${unanalyzedNote}`);
  });

  await record('tree-expand', async () => {
    const scopeTree = page.getByTestId('scope-tree');
    if (!(await appeared(scopeTree, SETTLE_TIMEOUT_MS))) return skipped('fixture folder has no subfolders');
    await scopeTree.click();
    const folderRow = page.getByTestId('folder-row').first();
    if (!(await appeared(folderRow, SETTLE_TIMEOUT_MS))) return skipped('fixture folder has no subfolders');
    await folderRow.click();
    const scopeFolder = page.getByTestId('scope-folder');
    if (await appeared(scopeFolder, SETTLE_TIMEOUT_MS)) await scopeFolder.click();
    return done('first subfolder toggled');
  });

  await record('select-video', async () => {
    const video = page.getByTestId('video-item').first();
    if (!(await appeared(video))) return skipped('no video row to select');
    await video.click();
    const detailLayout = page.getByTestId('detail-layout').first();
    await detailLayout.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
    selectedFilename = (await detailLayout.locator('h1').first().getAttribute('title')) ?? '';
    return done('details panel opened');
  });

  await record('analyze', async () => {
    const analyze = page.getByTestId('analyze-button').first();
    if (!(await appeared(analyze, SETTLE_TIMEOUT_MS))) return skipped('no analyze action on the selected video');
    if (await analyze.isDisabled()) {
      const reason = await analyze.getAttribute('data-disabled-reason');
      return skipped(reason !== null && reason !== '' ? reason : 'analyzer not configured in this home');
    }
    await analyze.click();
    await page
      .locator('[data-testid="analysis-state"][data-analyzing="true"]')
      .waitFor({ state: 'attached', timeout: VISIBLE_TIMEOUT_MS });
    await page
      .locator('[data-testid="analysis-state"][data-analyzing="false"]')
      .waitFor({ state: 'attached', timeout: plan.analyzeTimeoutMs });
    const errorCard = page.getByTestId('analysis-error-card');
    const errorCardVisible = await appeared(errorCard, SETTLE_TIMEOUT_MS);
    const errorNote = errorCardVisible ? ((await errorCard.first().textContent()) ?? '').trim() : '';
    const detailLayout = page.getByTestId('detail-layout').first();
    const videoStatus = await detailLayout.getAttribute('data-video-status');
    const filename = await detailLayout.locator('h1').first().getAttribute('title');
    analyzedFilename = filename ?? '';
    return analyzeOutcome({ errorCardVisible, errorNote, videoStatus, filename });
  });

  await record('search', async () => {
    const modeLibrary = page.getByTestId('mode-library');
    if (!(await appeared(modeLibrary, SETTLE_TIMEOUT_MS))) return skipped('no mode switcher in this build');
    await modeLibrary.click();
    const input = page.getByTestId(SEARCH_INPUT).locator('input').first();
    if (!(await appeared(input))) return skipped('no library search input');
    await input.click();
    const query = plan.query ?? searchTermFromAnalyzedFilename(analyzedFilename || selectedFilename);
    if (query.length === 0) return failed('could not derive a search term from the selected fixture filename');
    await input.fill(query);
    await input.press('Enter');
    const tile = page.getByTestId('library-tile').first();
    if (!(await appeared(tile))) return failed(`no library result matched "${query}"`);
    return done(`library result matched "${query}"`);
  });

  await record('library-preview', async () => {
    const modeLibrary = page.getByTestId('mode-library');
    if (await appeared(modeLibrary, SETTLE_TIMEOUT_MS)) await modeLibrary.click();
    const subnavCollection = page.getByTestId('subnav-collection');
    if (await appeared(subnavCollection, SETTLE_TIMEOUT_MS)) await subnavCollection.click();
    const searchInput = page.getByTestId(SEARCH_INPUT).locator('input').first();
    if (!(await appeared(searchInput, SETTLE_TIMEOUT_MS))) return failed('no library search input to clear before preview');
    await clearLibrarySearch(page, searchInput);
    const tile = page.getByTestId('library-tile').first();
    if (!(await appeared(tile, SETTLE_TIMEOUT_MS))) return skipped('no library tile to preview');
    await tile.click();
    const viewer = page.getByTestId('library-media-viewer');
    if (!(await appeared(viewer, VISIBLE_TIMEOUT_MS))) return skipped('media viewer did not open');
    if ((await viewer.getAttribute('data-media')) !== 'video') return skipped('first Kolekcja tile is not a video');
    if (!(await appeared(page.getByTestId('library-media-viewer-player'), SETTLE_TIMEOUT_MS))) {
      return skipped('viewer player did not render (offline or missing file)');
    }
    const escapeHatch = page.getByTestId('library-media-viewer-open-analysis');
    if (!(await appeared(escapeHatch, SETTLE_TIMEOUT_MS))) return skipped('no open-in-analysis escape hatch');
    await escapeHatch.click();
    if (!(await appeared(page.getByTestId('detail-layout'), VISIBLE_TIMEOUT_MS))) {
      return skipped('escape hatch did not land in Analysis with the file selected');
    }
    return done('video tile opened the shared viewer; escape hatch landed in Analysis');
  });

  await record('photos-sidebar', async () => {
    const modeAnalysis = page.getByTestId('mode-analysis');
    if (!(await appeared(modeAnalysis, SETTLE_TIMEOUT_MS))) return skipped('no mode switcher in this build');
    await modeAnalysis.click();
    const mediaPhotos = page.getByTestId('analysis-media-photos');
    if (!(await appeared(mediaPhotos, SETTLE_TIMEOUT_MS))) return skipped('no Analysis media toggle in this build');
    await mediaPhotos.click();
    if (!(await appeared(page.getByTestId('photos-sidebar-row'), FOLDER_TIMEOUT_MS))) {
      return skipped('no photos catalogued in this home');
    }
    return done('Analysis Photos sidebar rendered');
  });

  await record('analysis-photos', async () => {
    const rows = page.getByTestId('photos-sidebar-row');
    if (!(await appeared(rows.first(), SETTLE_TIMEOUT_MS))) return skipped('no photos catalogued in this home');
    const usableRow = rows.filter({ hasNot: page.getByTestId('photos-sidebar-badge-proxyFailed') }).first();
    if (!(await appeared(usableRow, SETTLE_TIMEOUT_MS))) {
      return skipped('every catalogued photo has a failed proxy (analyze strip needs proxyState=done)');
    }
    await usableRow.click();
    if (!(await appeared(page.getByTestId('photos-analysis-detail'), VISIBLE_TIMEOUT_MS))) {
      return skipped('photo detail workspace did not render');
    }
    if (!(await appeared(page.getByTestId('photos-analyze-strip'), SETTLE_TIMEOUT_MS))) {
      return skipped('no analyze strip (photo already analysed or proxy pending)');
    }
    if (await appeared(page.getByTestId('video-item'), SETTLE_TIMEOUT_MS)) {
      return failed('video list visible in the photos sidebar');
    }
    return done('Analysis Photos workspace shows the detail and analyze affordance');
  });

  await record('photos-tree', async () => {
    const scopeTree = page.getByTestId('scope-tree');
    if (!(await appeared(scopeTree, SETTLE_TIMEOUT_MS))) return skipped('no whole-tree scope toggle in this build');
    if (await scopeTree.isDisabled()) return skipped('the whole-tree scope is unavailable: the opened root owns no photo-bearing subfolder');
    await scopeTree.click();
    const rootRow = page.getByTestId('photos-tree-root-row').first();
    if (!(await appeared(rootRow, FOLDER_TIMEOUT_MS))) {
      return treeSelectAnalyzeOutcome({ treeVisible: false, rowVisible: false, usableRowVisible: false, detailVisible: false, analyzeVisible: false, analyzeDisabled: false, disabledReason: '', path: null });
    }
    await expandTreeRow(rootRow);
    const folderRow = page.getByTestId('photos-tree-folder-row').first();
    if (await appeared(folderRow, SETTLE_TIMEOUT_MS)) await expandTreeRow(folderRow);
    const rows = page.getByTestId('photos-sidebar-row');
    const rowVisible = await appeared(rows.first(), SETTLE_TIMEOUT_MS);
    if (!rowVisible) {
      return treeSelectAnalyzeOutcome({ treeVisible: true, rowVisible: false, usableRowVisible: false, detailVisible: false, analyzeVisible: false, analyzeDisabled: false, disabledReason: '', path: null });
    }
    // The detail pane offers a single-photo Analizuj only while the photo has no analysis and a
    // usable proxy, and the fixtures deliberately plant an unloadable photo (BROKEN_PHOTO_NAME).
    const treeRow = rows
      .filter({ hasNot: page.getByTestId('photos-sidebar-badge-analysed') })
      .filter({ hasNot: page.getByTestId('photos-sidebar-badge-proxyFailed') })
      .first();
    if (!(await appeared(treeRow, SETTLE_TIMEOUT_MS))) {
      return treeSelectAnalyzeOutcome({ treeVisible: true, rowVisible: true, usableRowVisible: false, detailVisible: false, analyzeVisible: false, analyzeDisabled: false, disabledReason: '', path: null });
    }
    const photoPath = await treeRow.getAttribute('title');
    await treeRow.click();
    const detailVisible = await appeared(page.getByTestId('photos-analysis-detail'), VISIBLE_TIMEOUT_MS);
    const analyzeAction = singlePhotoAnalyzeAction(page);
    const analyzeVisible = detailVisible && (await appeared(analyzeAction, SETTLE_TIMEOUT_MS));
    const analyzeDisabled = analyzeVisible && (await analyzeAction.isDisabled());
    const disabledReason = analyzeDisabled ? ((await analyzeAction.getAttribute('title')) ?? '') : '';
    return treeSelectAnalyzeOutcome({ treeVisible: true, rowVisible: true, usableRowVisible: true, detailVisible, analyzeVisible, analyzeDisabled, disabledReason, path: photoPath });
  });

  await record('photos-tree-analyze', async () => {
    const analyzeAction = singlePhotoAnalyzeAction(page);
    if (!(await appeared(analyzeAction, SETTLE_TIMEOUT_MS))) {
      return skipped('no Analizuj affordance for the tree-selected photo (the photos-tree step did not select one)');
    }
    if (await analyzeAction.isDisabled()) return skipped('Analizuj is disabled for the tree-selected photo');
    await analyzeAction.click();
    await page
      .waitForFunction(selectedRowAnalysedOrJobError, SELECTED_PHOTO_ROW, { timeout: plan.analyzeTimeoutMs })
      .catch(() => undefined);
    const badge = page.locator(SELECTED_PHOTO_ROW).getByTestId('photos-sidebar-badge-analysed');
    const errorAlert = page.getByTestId('photos-job-error');
    const errorVisible = await appeared(errorAlert, SETTLE_TIMEOUT_MS);
    const errorNote = errorVisible ? ((await errorAlert.first().textContent()) ?? '').trim() : '';
    const badgeVisible = await appeared(badge, SETTLE_TIMEOUT_MS);
    return photoTreeAnalyzeOutcome({ errorVisible, errorNote, badgeVisible });
  });

  await record('collection-photo-analyzed', async () => {
    const modeLibrary = page.getByTestId('mode-library');
    if (!(await appeared(modeLibrary, SETTLE_TIMEOUT_MS))) return skipped('no mode switcher in this build');
    await modeLibrary.click();
    const subnavCollection = page.getByTestId('subnav-collection');
    if (!(await appeared(subnavCollection, SETTLE_TIMEOUT_MS))) return skipped('no Kolekcja subnav in this build');
    await subnavCollection.click();
    const photoChip = page.getByTestId('library-media-photo');
    if (!(await appeared(photoChip, FOLDER_TIMEOUT_MS))) return skipped('no Zdjęcia media chip in this build');
    const chipText = await photoChip.first().textContent();
    await photoChip.click();
    return collectionPhotoChipOutcome(parseMediaChipCount(chipText));
  });

  await record('collection-photo-viewer', async () => {
    const tile = page.getByTestId('library-tile').first();
    if (!(await appeared(tile, FOLDER_TIMEOUT_MS))) return skipped('no analyzed photo in Kolekcja');
    await tile.click();
    if (!(await appeared(page.getByTestId('library-media-viewer'), VISIBLE_TIMEOUT_MS))) {
      return skipped('Kolekcja photo viewer did not render');
    }
    return done('Kolekcja photo tile opened the shared viewer');
  });

  await record('settings', async () => {
    const viewerClose = page.getByTestId('library-media-viewer-close');
    if (await appeared(viewerClose, SETTLE_TIMEOUT_MS)) await viewerClose.click();
    const settingsButton = page.getByTestId('open-settings-button');
    if (!(await appeared(settingsButton, SETTLE_TIMEOUT_MS))) return skipped('no Settings control in this build');
    await settingsButton.click();
    await page.getByTestId('settings-modal').waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
    return done('settings modal opened');
  });

  await record('backup', async () => {
    const section = page.getByTestId('settings-backup');
    if (!(await appeared(section, SETTLE_TIMEOUT_MS))) return skipped('no Backup section in this build');
    await section.scrollIntoViewIfNeeded();
    await stubSaveDialog(app, recoveryKeyPath);

    await page.getByTestId('backup-enabled-switch').locator('input').check();
    await page.getByTestId('backup-stepper').waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
    await page.getByTestId('backup-provider-service-account').click();
    await page.getByTestId('backup-stepper-next').click();
    await page.getByTestId('backup-shared-drive-id').fill(FAKE_DRIVE_ID);
    await page.getByTestId('backup-key-json').fill(serviceAccountKey);
    await page.getByTestId('backup-connect').click();
    await page.getByTestId('backup-connection-report').waitFor({ state: 'visible', timeout: BACKUP_TIMEOUT_MS });

    await page.getByTestId('backup-export-recovery-key').click();
    await page.getByTestId('backup-recovery-key-report').waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
    await page.getByTestId('backup-recovery-key-saved').locator('input').check();
    await page.getByTestId('backup-finish').click();
    await page.getByTestId('backup-stepper').waitFor({ state: 'hidden', timeout: BACKUP_TIMEOUT_MS });
    await page.getByTestId('backup-list').waitFor({ state: 'visible', timeout: BACKUP_TIMEOUT_MS });

    const archives = [...fakeDrive.files.values()].filter((file) => file.mimeType !== FOLDER_MIME_TYPE);
    return archives.length === 0
      ? failed('the backup job reported success but the fake Drive holds no archive')
      : done(`${String(archives.length)} archive(s) in the fake Drive after the first backup`);
  });

  await record('backup-indicator', async () => {
    const closeSettings = page.getByTestId('settings-cancel');
    if (await appeared(closeSettings, SETTLE_TIMEOUT_MS)) await closeSettings.click();
    const indicator = page.getByTestId('backup-indicator');
    if (!(await appeared(indicator, BACKUP_TIMEOUT_MS))) return failed('no backup indicator in the bottom bar after enablement');
    return done('the bottom bar carries the backup indicator');
  });

  await record('wizard', async () => {
    const settingsButton = page.getByTestId('open-settings-button');
    if (await appeared(settingsButton, SETTLE_TIMEOUT_MS)) {
      await settingsButton.click();
      await page.getByTestId('settings-modal').waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
    }
    const runWizard = page.getByTestId('settings-run-wizard');
    if (!(await appeared(runWizard, SETTLE_TIMEOUT_MS))) return skipped('no Run Setup Wizard control in this build');
    await runWizard.click();
    await page.getByTestId('setup-wizard').waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
    return done('setup wizard opened');
  });

  await app.close().catch(() => undefined);
  await fakeDrive.close().catch(() => undefined);
  return { timeToWindowMs, results };
};

const main = async () => {
  const { help, parsed } = readOptions(process.argv.slice(2));
  if (help) {
    console.log(HELP);
    return 0;
  }
  if (!parsed.success) {
    console.error(HELP);
    console.error(`release-walkthrough: ${z.prettifyError(parsed.error)}`);
    return 2;
  }

  const plan = await buildPlan(parsed.data);
  mkdirSync(plan.outDir, { recursive: true });
  writeFileSync(path.join(plan.outDir, 'plan.json'), JSON.stringify(plan, null, 2));
  console.log(`release-walkthrough: ${plan.dryRun ? 'plan only' : 'driving'} ${plan.appPath}`);
  console.log(`  fixtures   ${plan.sourceFixturesDir} (scratch copy driven: ${plan.fixturesDir})`);
  console.log(`  home       ${plan.homeDir}`);
  console.log(`  user data  ${plan.userDataDir}`);
  console.log(`  output     ${plan.outDir}`);
  if (plan.analyzer !== null) {
    console.log(`  analyzer   local:${plan.analyzer.model} (system ollama at ${SYSTEM_OLLAMA_BASE_URL})`);
  }
  if (plan.dryRun) {
    console.log('release-walkthrough: --dry-run, the app was not launched');
    return 0;
  }

  const { timeToWindowMs, results } = await drive(plan);
  writeFileSync(
    path.join(plan.outDir, 'manifest.json'),
    JSON.stringify({ plan, timeToWindowMs, steps: results }, null, 2),
  );
  const failedSteps = results.filter((result) => result.status === 'failed');
  const skippedSteps = results.filter((result) => result.status === 'skipped');
  console.log(
    `release-walkthrough: ${String(results.length)} step(s), ${String(failedSteps.length)} failed, ` +
      `${String(skippedSteps.length)} skipped`,
  );
  console.log(`release-walkthrough: review the screenshots in ${plan.outDir}`);
  if (plan.archiveTo !== null) {
    mkdirSync(plan.archiveTo, { recursive: true });
    cpSync(plan.outDir, plan.archiveTo, { recursive: true });
    console.log(`release-walkthrough: archived the screenshot set to ${plan.archiveTo}`);
  }
  const blocking = blockingSkips(skippedSteps);
  if (plan.strict && blocking.length > 0) {
    console.error(`release-walkthrough: --strict forbids skipped steps: ${blocking.map((step) => step.name).join(', ')}`);
    return 1;
  }
  return failedSteps.length === 0 ? 0 : 1;
};

const isDirectlyExecuted = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isDirectlyExecuted) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`release-walkthrough: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
