import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAll } from '../src/engine.js';
import { buildQuality } from '../src/quality.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ds = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/dataset.json'), 'utf8'));
const TODAY = '2026-10-09';
const chain = runAll(ds, { today: TODAY });
const source = runAll(ds, { today: TODAY, sourceOpeningLinks: true });
const Q = buildQuality(ds, chain, source);

test('quality: counts of source problems', () => {
  assert.equal(Q.counts.missingFormula, 20);
  assert.equal(Q.stray.length, 3);
  assert.equal(Q.counts.unresolved, 17);
  assert.equal(Q.counts.usdK, 25);
});

test('quality: USD\'K differences that reach the forecast are the two known cells', () => {
  const inF = Q.usdKCells.filter((x) => x.inForecast).sort((a, b) => a.row - b.row);
  assert.deepEqual(inF.map((x) => x.row), [1453, 2158]);
  assert.ok(Math.abs(inF[0].diffK - 7.5897) < 1e-3, 'row 1453: file 24.52 vs app 16.93');
  assert.ok(Math.abs(inF[1].diffK + 55.6041) < 1e-3, 'row 2158: wrong reference');
  assert.ok(Math.abs(Q.usdKForecastDiffK - (7.5897 - 55.6041)) < 1e-3);
});

test('quality: opening-link impact grows from 11.1 and the 10.x weeks carry only the cell differences', () => {
  assert.ok(Math.abs(Q.opening.endingDiffK[0] - 2299.9886) < 1e-2, 'week 11.1: source-link ending minus chained ending');
  assert.ok(Math.abs(Q.opening.endingDiffK[1] - 2386.5457) < 1e-2, 'week 11.2');
  assert.ok(Q.opening.maxAbsK > 2000);
});

test('quality: bank adjustments and overview range are reported with the numbers the app uses', () => {
  assert.equal(typeof Q.bankNet.vnd, 'number');
  assert.equal(Q.overviewRange.shortAll, 77);
  assert.equal(Q.overviewRange.shortExcel, 33);
  assert.equal(Q.overviewRange.excelRangeTo, '2026-11-17');
});

test('quality: blank-category item in the forecast and no items on the subtotal label', () => {
  assert.equal(Q.othersSubtotalItems, 0);
  assert.equal(Q.blankCategoryForecast.length, 1);
  assert.equal(Q.blankCategoryForecast[0].row, 2118);
});
