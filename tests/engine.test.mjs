// Engine tests: the engine must reproduce the cached values of SVL_Payment_Ver6_Final_Ver_2.xlsm.
// The known source-file problems are asserted explicitly; they are the only allowed differences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runAll, buildContext, derivePayment, weekContaining, weekApprox, suggestFx, addDays, dayOfWeek, weekMonday,
} from '../src/engine.js';
import { WEEKS } from '../src/structure.js';
import { serialToKey, toDateKey } from '../src/importer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const ds = load('fixtures/dataset.json');
const E = load('fixtures/expected.json');

const TODAY = '2026-10-09';
const OPENING = ds.settings.openingDate;
const R = runAll(ds, { today: TODAY });
const RSRC = runAll(ds, { today: TODAY, sourceOpeningLinks: true });

const blank = (v) => (v == null || v === '' ? null : v);
const same = (a, b) => blank(a) === blank(b);
const near = (a, b, tol = 0.01) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : same(a, b));
const round = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;

// Workbook cached values (Cashflow_Summary, USD'000K): index 0..27 = weeks 6.1..12.4, 16.. = forecast.
const xl = (row) => E.cashflow.rows[String(row)];
const cfRow = (res, row) => res.cashflow.rows.find((r) => r.row === row).values;

// ---------- payments ----------
test('payments: every computed column matches the workbook, except rows the source file leaves broken', () => {
  const bySource = new Map(R.ctx.payments.map((p) => [p.sourceRow, p]));
  const bad = [];
  const explained = { week: [], include: [], usd: [] };
  for (const x of E.payments) {
    const p = bySource.get(x.row);
    if (!p) { bad.push(['missing row', x.row]); continue; }
    // Rows whose source formulas are missing (dataIssue) have blank Z/AD/AG in the file: not comparable.
    if (!p.dataIssue) {
      if (!same(p.est, x.z)) bad.push([x.row, 'est', p.est, x.z]);
      if (!same(p.planDate, x.ad)) bad.push([x.row, 'planDate', p.planDate, x.ad]);
      if ((p.cashPlan ? 'Y' : '') !== (x.ag || '')) bad.push([x.row, 'cashPlan', p.cashPlan, x.ag]);
    }
    // The workbook's category labels carry leading spaces; the importer trims them on purpose.
    if (!same(blank(p.category), blank((x.aj || '').trim()))) bad.push([x.row, 'category', p.category, x.aj]);
    if (!same(p.weekPlan, x.ai == null ? null : String(x.ai))) {
      if (p.weekTyped) explained.week.push(x.row); else bad.push([x.row, 'week', p.weekPlan, x.ai]);
    }
    if (!same(p.include, x.ab)) {
      if (p.dataIssue) explained.include.push(x.row); else bad.push([x.row, 'include', p.include, x.ab]);
    }
    if (!p.dataIssue && !near(p.amountUsdK, x.ak, 1e-6)) {
      if (p.akIssue) explained.usd.push(x.row); else bad.push([x.row, 'usdK', p.amountUsdK, x.ak]);
    }
  }
  assert.deepEqual(bad, [], 'unexplained payment differences');
  assert.equal(explained.week.length, 2, 'typed week codes in rows 48/49 (January dates)');
  assert.equal(explained.include.length, 17, 'rows whose Include formula is missing in the source (stray rows 4741-4743 already match)');
  assert.equal(explained.usd.length, 21, 'USD\'K typed over the formula (15), wrong-row reference (5), blank on a Paid row (1)');
});

// ---------- Overview (the workbook's statistics cover Daily Plan rows 5..52 only) ----------
test('overview: totals match Overview!C22..C44', () => {
  const o = E.overview;
  const ov = R.plan.overview;
  const first48 = R.plan.days.slice(0, 48);
  assert.ok(near(ov.usdToVndAtDay1, o.C22), 'C22');
  assert.ok(near(ov.totalLiquidityVnd, o.C23), 'C23');
  assert.ok(near(Math.min(...first48.map((d) => d.closeVnd)), o.C26), 'C26 lowest VND');
  assert.ok(near(Math.min(...first48.map((d) => d.closeUsd)), o.C27, 1e-6), 'C27 lowest USD');
  assert.equal(first48.filter((d) => d.alert !== 'OK').length, o.C28, 'C28 shortfall days');
  assert.ok(near(ov.payablesVnd, o.C32), 'C32');
  assert.ok(near(ov.payablesUsd, o.C33, 1e-6), 'C33');
  assert.equal(ov.payablesCount, o.C34, 'C34');
  assert.ok(near(ov.reviewVnd, o.C37), 'C37');
  assert.equal(ov.reviewCount, o.C39, 'C39');
  assert.ok(near(ov.receiptsVnd, o.C43), 'C43');
  assert.ok(near(ov.receiptsUsd, o.C44, 1e-6), 'C44');
});

test('overview: the engine reports the full plan range (Oct 1 to Dec 31) as well', () => {
  assert.equal(R.plan.days.length, 92);
  assert.equal(R.plan.days[0].date, '2026-10-01');
  assert.equal(R.plan.days.at(-1).date, '2026-12-31');
  assert.equal(R.plan.days.filter((d) => d.alert !== 'OK').length, 77);
  assert.equal(R.plan.overview.shortfallDays, 77);
});

// ---------- Daily Plan ----------
test('daily plan: all 71 cached rows match exactly', () => {
  const fields = [
    ['date', 'date'], ['openVnd', 'open_vnd'], ['inVnd', 'in_vnd'], ['outVnd', 'out_vnd'],
    ['sellUsd', 'sell_usd'], ['buyUsd', 'buy_usd'], ['sellRate', 'sell_rate'], ['vndIn', 'vnd_in'],
    ['vndOut', 'vnd_out'], ['closeVnd', 'close_vnd'], ['openUsd', 'open_usd'], ['inUsd', 'in_usd'],
    ['outUsd', 'out_usd'], ['closeUsd', 'close_usd'], ['totalUsd', 'total_usd'], ['alert', 'alert'],
    ['netVnd', 'net_vnd'], ['bankInVnd', 'bank_in_vnd'], ['bankOutVnd', 'bank_out_vnd'],
  ];
  const bad = [];
  for (const x of E.dailyPlan) {
    const d = R.plan.days[x.row - 5];
    for (const [mine, theirs] of fields) {
      const a = d[mine];
      const b = x[theirs];
      const ok = typeof b === 'number' ? near(a, b, 0.01) : same(a, b);
      if (!ok) bad.push([x.row, mine, a, b]);
    }
  }
  assert.deepEqual(bad, []);
});

// ---------- Reconciliation ----------
test('reconciliation: all 8 cached rows match, status included', () => {
  const bad = [];
  for (const x of E.recon) {
    const r = R.recon.find((q) => q.date === x.date);
    const pairs = [
      ['act_vnd', r.actVnd], ['plan_vnd', r.planVnd], ['diff_vnd', r.diffVnd], ['bank_vnd', r.bankNetVnd],
      ['net_vnd', r.netDiffVnd], ['plan_usd', r.planUsd], ['diff_usd', r.diffUsd], ['bank_usd', r.bankNetUsd],
      ['net_usd', r.netDiffUsd],
    ];
    for (const [k, a] of pairs) if (!near(a, x[k])) bad.push([x.date, k, a, x[k]]);
    if (!same(r.status || null, x.status || null)) bad.push([x.date, 'status', r.status, x.status]);
  }
  assert.deepEqual(bad, []);
});

// ---------- Weekly Plan ----------
test('weekly plan: flows match; ending balances differ from the workbook only by bank adjustments', () => {
  const bankNet = (cur, to) => ds.bankAdj
    .filter((b) => (b.currency || '').toUpperCase() === cur && b.date >= OPENING && b.date <= to)
    .reduce((a, b) => a + ((b.direction || '').toUpperCase() === 'IN' ? 1 : -1) * (Number(b.amount) || 0), 0);
  const bad = [];
  for (const x of E.weekly) {
    const w = R.weekly.find((q) => q.code === String(x.code));
    const pairs = [
      ['in_vnd', w.inVnd], ['out_vnd', w.outVnd], ['sell_usd', w.sellUsd], ['buy_usd', w.buyUsd],
      ['net_fx_vnd', w.netFx], ['in_usd', w.inUsd], ['out_usd', w.outUsd],
    ];
    for (const [k, a] of pairs) if (!near(a, x[k], 0.01)) bad.push([x.code, k, a, x[k]]);
    if (x.end_vnd != null) {
      // The engine includes bank adjustments in weekly endings; the workbook's weekly columns K/L ignore them.
      if (!near(x.end_vnd - w.endVnd, -bankNet('VND', w.to), 0.01)) bad.push([x.code, 'end_vnd', w.endVnd, x.end_vnd]);
      if (!near(x.end_usd - w.endUsd, -bankNet('USD', w.to), 0.01)) bad.push([x.code, 'end_usd', w.endUsd, x.end_usd]);
    }
  }
  assert.deepEqual(bad, []);
});

// ---------- Cashflow_Summary ----------
test('cashflow: receipts, actual weeks and the Q58 anchor match the workbook', () => {
  const rc = cfRow(R, 15);
  const xr = xl(15);
  for (let i = 0; i < 28; i++) assert.ok(near(rc[i], xr[i], 1e-6), `receipts week ${i}`);
  // Actual weeks (6.1..9.4) are typed values in the workbook; the chained ending must reproduce Q58.
  assert.ok(near(cfRow(R, 58)[15], E.cashflow.Q58, 1e-6), 'Q58');
  assert.ok(near(cfRow(R, 8)[0], 1680.79542991051, 1e-6), 'opening balance of week 6.1 (USD\'K)');
});

test('cashflow: forecast net flow matches the workbook except the two known USD\'K cells', () => {
  // 10.1 (index 16): row 49 AK is typed 24.52 in the file, formula gives 16.93 -> net +7.5897 in the engine.
  // 10.3 (index 18): row 21 AK for item 2158 uses the wrong reference -> net -55.604 in the engine.
  const net = cfRow(R, 57);
  const xnet = xl(57);
  const expectedDiff = { 16: 7.5897, 18: -55.604 };
  for (let i = 16; i < 28; i++) {
    const d = round(net[i] - xnet[i], 4);
    assert.ok(Math.abs(d - (expectedDiff[i] ?? 0)) < 1e-3, `net week ${i}: ${d}`);
  }
});

test('cashflow: default (chained) endings differ from the workbook only through the source opening-link error', () => {
  const end = cfRow(R, 58);
  const xend = xl(58);
  const d = [];
  for (let i = 16; i < 28; i++) d.push(round(end[i] - xend[i], 4));
  // Weeks 10.1..10.4 carry the two known cell differences; from 11.1 the source's V8:AC8 link adds the jump.
  assert.deepEqual(d.slice(0, 4), [7.5897, 7.5897, -48.0143, -48.0143].map((x) => round(x, 4)));
  const expectedJumps = [-2292.3989, -2378.956, -2241.9176, -175.3679, -1747.5549, -1886.3567, -1627.195, 812.5326];
  d.slice(4).forEach((v, k) => assert.ok(Math.abs(v - expectedJumps[k]) < 1e-3, `week ${20 + k}: ${v}`));
});

test('cashflow: source-link mode reproduces the workbook endings, leaving only the two known cells', () => {
  const end = cfRow(RSRC, 58);
  const xend = xl(58);
  const d = [];
  for (let i = 16; i < 28; i++) d.push(round(end[i] - xend[i], 4));
  assert.deepEqual(d, [
    7.5897, 7.5897, -48.0143, -48.0143,
    7.5897, 7.5897, -48.0143, -48.0143,
    7.5897, 7.5897, -48.0143, -48.0143,
  ].map((x) => round(x, 4)));
});

test('cashflow: the default opening of 11.1 is the 10.4 ending, while the workbook link uses the 10.1 ending', () => {
  const chainOpen = cfRow(R, 8)[20];
  const srcOpen = cfRow(RSRC, 8)[20];
  assert.ok(near(chainOpen, cfRow(R, 58)[19], 1e-9), 'chain: opening 11.1 = ending 10.4');
  assert.ok(near(srcOpen, cfRow(RSRC, 58)[16], 1e-9), 'source: opening 11.1 = ending 10.1');
});

// ---------- Opex Control ----------
test('opex control: monthly grand totals match the workbook row 79', () => {
  assert.deepEqual(
    R.opex.grand.map((x) => round(x, 6)),
    E.opexTotals.row79.map((x) => round(Number(x), 6)),
  );
});

// ---------- Scope, start date and daily details ----------
test('plan start: a manual start earlier than the opening date is clamped to the opening', () => {
  const s = { ...ds, settings: { ...ds.settings, planStart: '2026-09-01' } };
  const c = buildContext(s, { today: TODAY });
  assert.equal(c.start, OPENING);
  assert.equal(c.startMode, 'MANUAL START');
});

test('plan start: a later manual start opens with the prior-day actual balances', () => {
  const s = { ...ds, settings: { ...ds.settings, planStart: '2026-10-05' } };
  const res = runAll(s, { today: TODAY });
  const prior = ds.recon['2026-10-04'];
  assert.equal(res.plan.days[0].date, '2026-10-05');
  assert.equal(res.plan.days[0].openVnd, prior.uobVnd + prior.vtVnd);
});

test('daily details: start from the detail date and VND totals per day', () => {
  const dd = R.details;
  assert.equal(dd[0].date, ds.settings.dailyDetailsStart);
  for (const day of dd) {
    const vnd = day.items.filter((x) => x.currency === 'VND').reduce((a, x) => a + Number(x.amount), 0);
    assert.equal(round(day.totalVnd, 2), round(vnd, 2), day.date);
  }
});

// ---------- helpers and classification ----------
test('date helpers', () => {
  assert.equal(serialToKey(46023), '2026-01-01');
  assert.equal(toDateKey('05/10/2026'), '2026-10-05');
  assert.equal(toDateKey('2026-10-05'), '2026-10-05');
  assert.equal(toDateKey(''), null);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(dayOfWeek('2026-10-01'), 'Thu');
  assert.equal(weekMonday('2026-10-01'), '2026-09-28');
});

test('week lookups: exact containment vs approximate start-date match', () => {
  assert.equal(weekContaining(WEEKS, '2026-10-01'), '10.1');
  assert.equal(weekContaining(WEEKS, '2026-12-31'), '12.4');
  assert.equal(weekContaining(WEEKS, '2025-01-01'), '');
  assert.equal(weekApprox(WEEKS, '2026-10-03'), '10.1');
  assert.equal(weekApprox(WEEKS, ''), '');
});

test('payment classification branches', () => {
  const c = buildContext(ds, { today: TODAY });
  const base = {
    id: 'x', item: 'x', currency: 'VND', amount: 1e9, reqDate: '2026-10-02', dueDate: null,
    lenaPlanDate: null, actualDate: null, actualRaw: '', category: 'Cat', project: '',
  };
  const cls = (over) => derivePayment({ ...base, ...over }, c);
  assert.equal(cls({ currency: 'EUR' }).include, '—');
  assert.equal(cls({ actualRaw: 'Old' }).include, 'No');
  assert.equal(cls({ actualRaw: 'check later' }).include, 'Review');
  assert.equal(cls({}).include, 'Yes');
  assert.equal(cls({ dataIssue: 'x', issueResolved: false }).include, 'Lỗi dữ liệu');
  assert.equal(cls({ dataIssue: 'x', issueResolved: true }).include, 'Yes');
  const paid = cls({ actualDate: '2026-10-03' });
  assert.equal(paid.include, 'Paid');
  assert.equal(paid.planDate, '2026-10-03');
  assert.equal(cls({ reqDate: '2027-02-01' }).include, '—', 'after the scope end');
  assert.equal(cls({ lenaPlanDate: '2026-09-01' }).est, c.forecastStart, 'past plan date moves to forecast start');
  assert.match(cls({ lenaPlanDate: '2026-09-01' }).overdueFlag, /Overdue/);
  assert.equal(cls({ amount: 1000, currency: 'USD' }).amountUsdK, 1);
  assert.equal(cls({ amount: 26300000, currency: 'VND' }).amountUsdK, 1);
});

test('FX suggestion covers a VND shortfall by selling USD and a USD shortfall by buying', () => {
  const s = suggestFx({ shortVnd: 1e9, sellRate: 26000, shortUsd: 0 });
  assert.equal(s.sellUsd, Math.ceil(1e9 / 26000));
  assert.equal(s.buyUsd, undefined);
  const b = suggestFx({ shortVnd: 0, sellRate: 26000, shortUsd: 5000.5 });
  assert.equal(b.buyUsd, 5001);
  assert.deepEqual(suggestFx({ shortVnd: 0, sellRate: 26000, shortUsd: 0 }), {});
});

test('alerts: a day is OK only when both buffers are met', () => {
  for (const d of R.plan.days) {
    const ok = d.closeVnd >= ds.settings.minVnd && d.closeUsd >= ds.settings.minUsd;
    assert.equal(d.alert === 'OK', ok, d.date);
  }
});

// ---------- importer (optional: needs the original workbook, path in SVL_XLSM) ----------
const XLSM = process.env.SVL_XLSM || '/mnt/user-data/uploads/165563b6-SVL_Payment_Ver6_Final_Ver_2.xlsm';
test('importer: the original workbook reproduces the committed dataset', { skip: !XLSM || !fs.existsSync(XLSM) }, async () => {
  const XLSX = (await import('xlsx')).default;
  const { importWorkbook } = await import('../src/importer.js');
  const out = importWorkbook(XLSX, fs.readFileSync(XLSM));
  assert.equal(out.payments.length, ds.payments.length);
  assert.equal(out.receipts.length, ds.receipts.length);
  assert.equal(out.bankAdj.length, ds.bankAdj.length);
});
