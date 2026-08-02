import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { _electron as electron } from '@playwright/test';
import { z } from 'zod';

const HELP = `release-walkthrough — scripted self-QA pass over a packaged build.

Usage:
  node scripts/release-walkthrough.mjs --app "<AI Video Cataloger.app>" --fixtures <folder> [options]

Options:
  --app <path>                 Packaged .app bundle to drive (required).
  --fixtures <path>            Folder of sample videos the walkthrough opens (required).
  --out <path>                 Root for the screenshot set (default: release/walkthrough).
  --home <path>                Prepared QA home; the default throwaway temp home has no analyzer
                               configured, so the analysis step reports itself skipped.
  --query <text>               Query typed into the Library search (default: "video").
  --analyze-timeout <seconds>  Wait for one analysis run to finish (default: 300).
  --window-size <WxH>          Window size for the driven app, e.g. 1920x1200 (default: 1920x1200).
  --dry-run                    Validate the inputs, write plan.json, stop before launching the app.
  --strict                     Exit 1 if any step reports 'skipped' (release runs use this).
  --help                       Print this help.

Every run launches with an isolated user-data directory, an isolated home and
AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN=1: it never reads or writes the real catalog,
the real settings or the login keychain.
`;

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const SEARCH_INPUT = 'library-search-input';
const VISIBLE_TIMEOUT_MS = 15_000;
const SETTLE_TIMEOUT_MS = 5_000;
const FOLDER_TIMEOUT_MS = 60_000;
const SCREENSHOT_SETTLE_TIMEOUT_MS = 3_000;
const SCREENSHOT_SETTLE_FALLBACK_MS = 250;
const DEFAULT_WINDOW_SIZE = '1920x1200';
const WINDOW_SIZE_PATTERN = /^(\d+)x(\d+)$/;

const optionsSchema = z.object({
  app: z.string().min(1),
  fixtures: z.string().min(1),
  out: z.string().min(1).optional(),
  home: z.string().min(1).optional(),
  query: z.string().min(1).default('video'),
  analyzeTimeout: z.coerce.number().int().positive().default(300),
  windowSize: z.string().regex(WINDOW_SIZE_PATTERN, 'expected WxH, e.g. 1920x1200').default(DEFAULT_WINDOW_SIZE),
  dryRun: z.boolean().default(false),
  strict: z.boolean().default(false),
});

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

const buildPlan = (options) => {
  const appPath = requireDirectory(options.app, '--app');
  const fixturesDir = requireDirectory(options.fixtures, '--fixtures');
  const outRoot = options.out === undefined ? path.join(REPO_ROOT, 'release', 'walkthrough') : path.resolve(options.out);
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'avc-walkthrough-userdata-'));
  const homeDir = options.home === undefined
    ? mkdtempSync(path.join(tmpdir(), 'avc-walkthrough-home-'))
    : requireDirectory(options.home, '--home');
  const windowSize = parseWindowSize(options.windowSize);
  return {
    appPath,
    executablePath: executableInside(appPath),
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
  };
};

const isolatedEnvironment = (plan) => ({
  ...process.env,
  HOME: plan.homeDir,
  USERPROFILE: plan.homeDir,
  AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN: '1',
  AI_VIDEO_CATALOGER_USER_DATA_DIR: plan.userDataDir,
});

const seedWindowState = (plan) => {
  writeFileSync(
    path.join(plan.userDataDir, 'window-state.json'),
    JSON.stringify({ width: plan.windowWidth, height: plan.windowHeight }, null, 2),
  );
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

/* eslint-disable no-undef -- runs inside the driven page via Playwright's waitForFunction, not this Node process */
const noPendingTransitionsOrSpinners = () =>
  document.getAnimations().every((animation) => animation.playState !== 'running') &&
  document.querySelector('[role="progressbar"], [data-testid*="spinner" i], [data-testid*="loading" i]') === null;
/* eslint-enable no-undef */

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

const drive = async (plan) => {
  seedWindowState(plan);
  const launchedAt = Date.now();
  const app = await electron.launch({
    executablePath: plan.executablePath,
    args: [`--user-data-dir=${plan.userDataDir}`],
    env: isolatedEnvironment(plan),
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const timeToWindowMs = Date.now() - launchedAt;

  const { results, record } = createRecorder(page, plan.outDir);

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
    const count = await page.getByTestId('video-item').count();
    return done(`${String(count)} video row(s) listed`);
  });

  await record('tree-expand', async () => {
    const switchToTree = page.getByTestId('switch-to-tree');
    if (await appeared(switchToTree, SETTLE_TIMEOUT_MS)) await switchToTree.click();
    const folderRow = page.getByRole('treeitem');
    if (!(await appeared(folderRow, SETTLE_TIMEOUT_MS))) return skipped('fixture folder has no subfolders');
    await folderRow.first().click();
    return done('first subfolder toggled');
  });

  await record('select-video', async () => {
    const video = page.getByTestId('video-item').first();
    if (!(await appeared(video))) return skipped('no video row to select');
    await video.click();
    await page.getByTestId('detail-layout').first().waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
    return done('details panel opened');
  });

  await record('analyze', async () => {
    const analyze = page.getByTestId('analyze-button').first();
    if (!(await appeared(analyze, SETTLE_TIMEOUT_MS))) return skipped('no analyze action on the selected video');
    if (await analyze.isDisabled()) return skipped('analyzer not configured in this home');
    await analyze.click();
    await page
      .locator('[data-testid="analysis-state"][data-analyzing="true"]')
      .waitFor({ state: 'attached', timeout: VISIBLE_TIMEOUT_MS });
    await page
      .locator('[data-testid="analysis-state"][data-analyzing="false"]')
      .waitFor({ state: 'attached', timeout: plan.analyzeTimeoutMs });
    return done('one analysis run finished');
  });

  await record('search', async () => {
    const modeLibrary = page.getByTestId('mode-library');
    if (!(await appeared(modeLibrary, SETTLE_TIMEOUT_MS))) return skipped('no mode switcher in this build');
    await modeLibrary.click();
    const input = page.getByTestId(SEARCH_INPUT).locator('input').first();
    if (!(await appeared(input))) return skipped('no library search input');
    await input.click();
    await input.fill(plan.query);
    await input.press('Enter');
    const filtered = page.getByTestId('library-no-match').or(page.getByTestId('library-tile'));
    if (!(await appeared(filtered))) return skipped(`no filtered library view for "${plan.query}"`);
    return done(`library filtered for "${plan.query}"`);
  });

  await record('library-preview', async () => {
    const modeLibrary = page.getByTestId('mode-library');
    if (await appeared(modeLibrary, SETTLE_TIMEOUT_MS)) await modeLibrary.click();
    const subnavCollection = page.getByTestId('subnav-collection');
    if (await appeared(subnavCollection, SETTLE_TIMEOUT_MS)) await subnavCollection.click();
    const tile = page.getByTestId('library-tile').first();
    if (!(await appeared(tile, SETTLE_TIMEOUT_MS))) return skipped('no library tile to preview');
    await tile.click();
    if (!(await appeared(page.getByTestId('browse-preview'), VISIBLE_TIMEOUT_MS))) {
      return skipped('browse preview did not open');
    }
    if (!(await appeared(page.getByTestId('preview-player'), SETTLE_TIMEOUT_MS))) {
      return skipped('preview player did not render (offline or missing file)');
    }
    const escapeHatch = page.getByTestId('preview-open-analysis');
    if (!(await appeared(escapeHatch, SETTLE_TIMEOUT_MS))) return skipped('no open-in-analysis escape hatch');
    await escapeHatch.click();
    if (!(await appeared(page.getByTestId('detail-layout'), VISIBLE_TIMEOUT_MS))) {
      return skipped('escape hatch did not land in Analysis with the file selected');
    }
    return done('tile opened a preview; escape hatch landed in Analysis');
  });

  await record('photos-browse', async () => {
    const modeLibrary = page.getByTestId('mode-library');
    if (await appeared(modeLibrary, SETTLE_TIMEOUT_MS)) await modeLibrary.click();
    const subnavPhotos = page.getByTestId('subnav-photos');
    if (!(await appeared(subnavPhotos, SETTLE_TIMEOUT_MS))) return skipped('no Photos subnav in this build');
    await subnavPhotos.click();
    const tile = page.getByTestId('photos-tile').first();
    if (!(await appeared(tile, FOLDER_TIMEOUT_MS))) return skipped('no photos catalogued in this home');
    await tile.click();
    if (!(await appeared(page.getByTestId('photos-detail'), VISIBLE_TIMEOUT_MS))) {
      return skipped('photo detail pane did not render');
    }
    if (await appeared(page.getByTestId('photos-analyze-strip'), SETTLE_TIMEOUT_MS)) {
      return { status: 'failed', note: 'analyze strip visible in the browse Photos surface' };
    }
    return done('browse Photos detail pane shows no analyze affordance');
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
    const row = page.getByTestId('photos-sidebar-row').first();
    if (!(await appeared(row, SETTLE_TIMEOUT_MS))) return skipped('no photos catalogued in this home');
    await row.click();
    if (!(await appeared(page.getByTestId('photos-analysis-detail'), VISIBLE_TIMEOUT_MS))) {
      return skipped('photo detail workspace did not render');
    }
    if (!(await appeared(page.getByTestId('photos-analyze-strip'), SETTLE_TIMEOUT_MS))) {
      return skipped('no analyze strip (photo already analysed or proxy pending)');
    }
    if (await appeared(page.getByTestId('video-item'), SETTLE_TIMEOUT_MS)) {
      return { status: 'failed', note: 'video list visible in the photos sidebar' };
    }
    return done('Analysis Photos workspace shows the detail and analyze affordance');
  });

  await record('photos-tab', async () => {
    const modeLibrary = page.getByTestId('mode-library');
    if (await appeared(modeLibrary, SETTLE_TIMEOUT_MS)) await modeLibrary.click();
    const subnavPhotos = page.getByTestId('subnav-photos');
    if (!(await appeared(subnavPhotos, SETTLE_TIMEOUT_MS))) return skipped('no Photos subnav in this build');
    await subnavPhotos.click();
    if (!(await appeared(page.getByTestId('photos-layout'), FOLDER_TIMEOUT_MS))) return skipped('Photos view did not render');
    return done('Photos view opened');
  });

  await record('photos-grid', async () => {
    if (!(await appeared(page.getByTestId('photos-grid'), FOLDER_TIMEOUT_MS))) {
      return skipped('no photos catalogued in this home');
    }
    const tiles = await page.getByTestId('photos-tile').count();
    if (tiles === 0) return skipped('photo grid rendered with no tiles');
    return done(`${String(tiles)} photo tile(s) listed`);
  });

  await record('photo-detail', async () => {
    const tile = page.getByTestId('photos-tile').first();
    if (!(await appeared(tile, SETTLE_TIMEOUT_MS))) return skipped('no photo tile to select');
    await tile.click();
    if (!(await appeared(page.getByTestId('photos-detail'), VISIBLE_TIMEOUT_MS))) {
      return skipped('photo detail pane did not render');
    }
    return done('photo detail pane opened');
  });

  await record('settings', async () => {
    const settingsButton = page.getByTestId('open-settings-button');
    if (!(await appeared(settingsButton, SETTLE_TIMEOUT_MS))) return skipped('no Settings control in this build');
    await settingsButton.click();
    await page.getByTestId('settings-modal').waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
    return done('settings modal opened');
  });

  await record('wizard', async () => {
    const runWizard = page.getByTestId('settings-run-wizard');
    if (!(await appeared(runWizard, SETTLE_TIMEOUT_MS))) return skipped('no Run Setup Wizard control in this build');
    await runWizard.click();
    await page.getByTestId('setup-wizard').waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
    return done('setup wizard opened');
  });

  await app.close().catch(() => undefined);
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

  const plan = buildPlan(parsed.data);
  mkdirSync(plan.outDir, { recursive: true });
  writeFileSync(path.join(plan.outDir, 'plan.json'), JSON.stringify(plan, null, 2));
  console.log(`release-walkthrough: ${plan.dryRun ? 'plan only' : 'driving'} ${plan.appPath}`);
  console.log(`  fixtures   ${plan.fixturesDir}`);
  console.log(`  home       ${plan.homeDir}`);
  console.log(`  user data  ${plan.userDataDir}`);
  console.log(`  output     ${plan.outDir}`);
  if (plan.dryRun) {
    console.log('release-walkthrough: --dry-run, the app was not launched');
    return 0;
  }

  const { timeToWindowMs, results } = await drive(plan);
  writeFileSync(
    path.join(plan.outDir, 'manifest.json'),
    JSON.stringify({ plan, timeToWindowMs, steps: results }, null, 2),
  );
  const failed = results.filter((result) => result.status === 'failed');
  const skippedSteps = results.filter((result) => result.status === 'skipped');
  console.log(
    `release-walkthrough: ${String(results.length)} step(s), ${String(failed.length)} failed, ` +
      `${String(skippedSteps.length)} skipped`,
  );
  console.log(`release-walkthrough: review the screenshots in ${plan.outDir}`);
  if (plan.strict && skippedSteps.length > 0) {
    console.error(`release-walkthrough: --strict forbids skipped steps: ${skippedSteps.map((step) => step.name).join(', ')}`);
    return 1;
  }
  return failed.length === 0 ? 0 : 1;
};

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`release-walkthrough: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
