import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const logoPath = path.join(repoRoot, 'landing', 'public', 'logo.svg');
const buildDir = path.join(repoRoot, 'build');
const iconPngPath = path.join(buildDir, 'icon.png');
const iconIcnsPath = path.join(buildDir, 'icon.icns');
const canvasSize = 1024;

const iconsetSizes = [
  { file: 'icon_16x16.png', size: 16 },
  { file: 'icon_16x16@2x.png', size: 32 },
  { file: 'icon_32x32.png', size: 32 },
  { file: 'icon_32x32@2x.png', size: 64 },
  { file: 'icon_128x128.png', size: 128 },
  { file: 'icon_128x128@2x.png', size: 256 },
  { file: 'icon_256x256.png', size: 256 },
  { file: 'icon_256x256@2x.png', size: 512 },
  { file: 'icon_512x512.png', size: 512 },
  { file: 'icon_512x512@2x.png', size: 1024 },
];

const renderIconPng = async () => {
  const svgMarkup = await readFile(logoPath, 'utf8');
  const html = `<!doctype html><html><head><style>
    html, body { margin: 0; padding: 0; }
    svg { width: ${canvasSize}px; height: ${canvasSize}px; display: block; }
  </style></head><body>${svgMarkup}</body></html>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: canvasSize, height: canvasSize } });
    await page.setContent(html);
    await mkdir(buildDir, { recursive: true });
    await page.screenshot({ path: iconPngPath, omitBackground: true });
  } finally {
    await browser.close();
  }
};

const buildIcns = async () => {
  const iconsetDir = await mkdtemp(path.join(tmpdir(), 'avc-icon-'));
  const appIconset = path.join(iconsetDir, 'icon.iconset');
  await mkdir(appIconset, { recursive: true });

  for (const { file, size } of iconsetSizes) {
    execFileSync('sips', ['-z', String(size), String(size), iconPngPath, '--out', path.join(appIconset, file)], {
      stdio: 'ignore',
    });
  }

  execFileSync('iconutil', ['-c', 'icns', appIconset, '-o', iconIcnsPath]);
  await rm(iconsetDir, { recursive: true, force: true });
};

await renderIconPng();
await buildIcns();
console.log(`Wrote ${path.relative(repoRoot, iconPngPath)} and ${path.relative(repoRoot, iconIcnsPath)}`);
