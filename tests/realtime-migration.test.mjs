import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDataset, withDefaults } from '../js/store.js';
import { runAll } from '../src/engine.js';
import { importWorkbook } from '../src/importer.js';
import { CASHFLOW_ACTUALS, CASHFLOW_OPENING, CASHFLOW_ROWS } from '../src/structure.js';

test('public source no longer provides confidential actual cashflow', () => {
  assert.deepEqual(CASHFLOW_ACTUALS, {});
  assert.equal(CASHFLOW_OPENING, null);
});

test('private backup actuals remain usable by the engine', () => {
  const ds = withDefaults({
    ...emptyDataset(),
    cashflowOpening: 1234.25,
    cashflowActuals: { 10: [777.5, 222.75] },
  });
  const calc = runAll(ds, { today: '2026-10-05' });
  assert.equal(calc.cashflow.rows.find(r => r.row === 10).values[0], 777.5);
  assert.equal(calc.cashflow.weeks[0].actual, true);
  assert.equal(calc.cashflow.rows.find(r => r.row === 8).values[0], 1234.25);
});

test('empty history cannot masquerade as actual 2026 weeks', () => {
  const calc = runAll(withDefaults(emptyDataset()), { today: '2026-10-05' });
  assert.equal(calc.cashflow.weeks[0].actual, false);
});

test('Excel importer reads Cashflow_Summary actual cells into private data', () => {
  const names = ['Overview', 'Opening Balances', 'Payment Request List', 'Receipts',
    'FX Transactions', 'Bank Adjustments', 'Reconciliation', 'Opex Control',
    'Cashflow_Summary'];
  const sheets = Object.fromEntries(names.map(n => [n, { '!ref': 'A1:B2' }]));
  sheets.Overview.F13 = { v: '2026-10-01' };
  sheets.Overview.F16 = { v: '2026-12-31' };
  sheets.Cashflow_Summary.B8 = { v: 1234.25 };
  sheets.Cashflow_Summary.B10 = { v: 777.5 };
  sheets.Cashflow_Summary.C10 = { v: 222.75 };
  const ds = importWorkbook({ read: () => ({ Sheets: sheets }) }, new ArrayBuffer(0));
  assert.equal(ds.cashflowOpening, 1234.25);
  assert.equal(ds.cashflowActuals['10'][0], 777.5);
  assert.equal(ds.cashflowActuals['10'][1], 222.75);
  assert.ok(CASHFLOW_ROWS.some(r => r.row === 10));
});
