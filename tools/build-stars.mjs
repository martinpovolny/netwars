// Reduce the HYG star catalog to the compact set NETWARS ships.
//
//   node tools/build-stars.mjs [path/to/hygdata.csv] [magLimit]
//
// Source: HYG Database v4.x (astronexus/HYG-Database), CSV with a header row.
// We keep every star up to `magLimit` apparent magnitude (default 6.5 — the
// naked-eye sky), dropping only their RA/Dec, magnitude and B-V colour index,
// rounded hard. Output: client/render/stars.json as parallel arrays, brightest
// first.
//
// Re-run this only to change the magnitude cut or refresh the catalogue; the
// committed stars.json is what the client actually loads.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const csvPath = process.argv[2] || resolve(HERE, 'hygdata.csv');
const magLimit = Number(process.argv[3] || 6.5);

const text = readFileSync(csvPath, 'utf8');
const lines = text.split(/\r?\n/);
const header = lines[0].split(',').map((s) => s.replace(/^"|"$/g, ''));
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`column "${name}" not found in ${csvPath}`);
  return i;
};
const cId = col('id');
const cRa = col('ra');     // hours, 0..24
const cDec = col('dec');   // degrees, -90..90
const cMag = col('mag');   // apparent magnitude
const cCi = col('ci');     // B-V colour index (may be blank)

const rows = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  // HYG has no commas inside fields for the columns we read, a plain split is safe
  const f = line.split(',');
  if (f[cId] === '0') continue;            // Sol
  const mag = Number(f[cMag]);
  if (!Number.isFinite(mag) || mag > magLimit) continue;
  const ra = Number(f[cRa]);
  const dec = Number(f[cDec]);
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
  const ciRaw = Number(f[cCi]);
  const ci = Number.isFinite(ciRaw) ? ciRaw : 0.6;   // ~white default
  rows.push({ ra, dec, mag, ci });
}

rows.sort((a, b) => a.mag - b.mag);   // brightest first

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r2 = (x) => Math.round(x * 1e2) / 1e2;
const out = {
  _note: `HYG catalogue reduced to mag <= ${magLimit}; ra in hours, dec in degrees, brightest first`,
  n: rows.length,
  ra: rows.map((s) => r4(s.ra)),
  dec: rows.map((s) => r4(s.dec)),
  mag: rows.map((s) => r2(s.mag)),
  ci: rows.map((s) => r2(s.ci)),
};

const dest = resolve(HERE, '../client/render/stars.json');
writeFileSync(dest, JSON.stringify(out));
const kb = (readFileSync(dest).length / 1024).toFixed(0);
console.log(`${rows.length} stars <= mag ${magLimit}  ->  ${dest}  (${kb} KB)`);
