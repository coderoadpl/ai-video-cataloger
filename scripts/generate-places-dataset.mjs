import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , citiesPath, admin1Path, countryInfoPath, outputPath, datasetId] = process.argv;

if (citiesPath === undefined || admin1Path === undefined || countryInfoPath === undefined || outputPath === undefined || datasetId === undefined) {
  console.error(
    'Usage: node scripts/generate-places-dataset.mjs <cities1000.txt> <admin1CodesASCII.txt> <countryInfo.txt> <output.tsv> <datasetId>',
  );
  process.exitCode = 1;
  throw new Error('Missing arguments');
}

const parseAdmin1 = async (filePath) => {
  const raw = await readFile(filePath, 'utf8');
  const byCode = new Map();
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const [code, name] = line.split('\t');
    if (code === undefined || name === undefined) continue;
    byCode.set(code, name);
  }
  return byCode;
};

const parseCountryInfo = async (filePath) => {
  const raw = await readFile(filePath, 'utf8');
  const byCode = new Map();
  for (const line of raw.split('\n')) {
    if (line.length === 0 || line.startsWith('#')) continue;
    const columns = line.split('\t');
    const iso = columns[0];
    const name = columns[4];
    if (iso === undefined || name === undefined) continue;
    byCode.set(iso, name);
  }
  return byCode;
};

const asciiSafeName = (name, asciiname) => {
  const nfc = name.normalize('NFC');
  return nfc === name ? name : asciiname;
};

const admin1ByCode = await parseAdmin1(admin1Path);
const countryByCode = await parseCountryInfo(countryInfoPath);

const citiesRaw = await readFile(citiesPath, 'utf8');
const rows = [];
for (const line of citiesRaw.split('\n')) {
  if (line.length === 0) continue;
  const columns = line.split('\t');
  const [, name, asciiname, , lat, lon, , , countryCode, , admin1Code, , , , population] = columns;
  if (name === undefined || lat === undefined || lon === undefined || countryCode === undefined) continue;
  const regionKey = `${countryCode}.${admin1Code ?? ''}`;
  const regionName = admin1ByCode.get(regionKey) ?? '';
  const countryName = countryByCode.get(countryCode) ?? '';
  rows.push({
    lat: Number(lat),
    lon: Number(lon),
    name: asciiSafeName(name, asciiname ?? name),
    regionName,
    countryCode,
    countryName,
    population: Number(population ?? 0) || 0,
  });
}

rows.sort((left, right) => left.lat - right.lat || left.lon - right.lon);

const header = `#avc-places\t1\t${datasetId}`;
const body = rows
  .map((row) => [row.lat, row.lon, row.name, row.regionName, row.countryCode, row.countryName, row.population].join('\t'))
  .join('\n');
const content = `${header}\n${body}\n`;

await writeFile(outputPath, content, 'utf8');

const sha256 = createHash('sha256').update(content).digest('hex');
const bytes = Buffer.byteLength(content, 'utf8');

console.log(`Wrote ${rows.length} rows to ${path.resolve(outputPath)}`);
console.log(`sha256: ${sha256}`);
console.log(`bytes: ${bytes}`);
