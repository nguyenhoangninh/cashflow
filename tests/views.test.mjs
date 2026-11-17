// Smoke tests for the screens: every view renders from the real dataset, shows the right numbers,
// and keeps its HTML balanced. No browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAll } from '../src/engine.js';
import { buildQuality } from '../src/quality.js';
import { render, TABS, filterCashflow, CF_FILTER_DEFAULT } from '../js/views.js';
import { fmtInt, fmt2, fmtDate, esc, toNum, toDate } from '../js/format.js';
import { emptyDataset, withDefaults, reduce } from '../js/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ds = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/dataset.json'), 'utf8'));
const TODAY = '2026-10-09';
const chain = runAll(ds, { today: TODAY });
const source = runAll(ds, { today: TODAY, sourceOpeningLinks: true });
const state = {
  view: 'overview', ds, calc: chain, chain, Q: buildQuality(ds, chain, source),
  pay: { q: '', include: '', cur: '', cat: '', page: 0 }, dayKey: null,
  importPreview: null, importStatus: '', message: '', messageKind: '',
  status: { mode: 'local', state: 'ready', message: '' }, user: null,
};
const balanced = (html, tag) => (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length === (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;

test('every tab renders with data and keeps HTML balanced', () => {
  for (const [id] of TABS) {
    const html = render(id, state);
    assert.ok(html.length > 200, id);
    for (const tag of ['table', 'div', 'tr', 'td', 'th', 'form', 'select', 'details', 'button']) {
      assert.ok(balanced(html, tag), `${id}: unbalanced <${tag}>`);
    }
    assert.ok(!html.includes('undefined'), `${id}: contains "undefined"`);
    assert.ok(!html.includes('NaN'), `${id}: contains NaN`);
  }
});

test('overview shows the workbook opening balances and the full-range shortfall count', () => {
  const html = render('overview', state);
  assert.ok(html.includes(fmtInt(11079273659)), 'opening VND');
  assert.ok(html.includes(fmt2(2250639.31)), 'opening USD');
  assert.ok(html.includes('77 / 92'), 'shortfall count over the full plan range');
  assert.ok(html.includes('MANUAL START'));
});

test('plan has one row per day and flags the short days', () => {
  const html = render('plan', state);
  const rows = (html.match(/<tr[ >]/g) || []).length - 1; // minus the header row
  assert.equal(rows, 92);
  assert.equal((html.match(/class="bad-row"/g) || []).length, 77);
  assert.ok(html.includes('Bán'), 'FX suggestion buttons');
});

test('payments: filter by include and paginate 150 per page', () => {
  const all = render('payments', state);
  assert.ok(all.includes('Trang 1/'), 'paging');
  const f = { ...state, pay: { q: '', include: 'Lỗi dữ liệu', cur: '', cat: '', page: 0 } };
  const html = render('payments', f);
  assert.ok(html.includes('17 / 2,277'), 'shows 17 matching rows out of 2,277');
});

test('category select never offers the Cashflow subtotal label', () => {
  const html = render('payments', state);
  assert.ok(!html.includes('Others (R&amp;M') && !html.includes('Others (R&M'));
});

test('quality lists the known source differences with the computed numbers', () => {
  const html = render('quality', state);
  assert.ok(html.includes('Liên kết số dư đầu kỳ'));
  assert.ok(html.includes(fmt2(2299.9886)), 'opening-link impact on the 11.1 ending');
  assert.ok(html.includes('Dòng 2158'));
});

test('cashflow switch shows the selected opening-link mode', () => {
  const chainHtml = render('cashflow', state);
  assert.ok(/value="chain" data-change="cfmode" checked/.test(chainHtml));
  const srcState = { ...state, ds: { ...ds, settings: { ...ds.settings, cfSourceLinks: true } }, calc: source };
  const srcHtml = render('cashflow', srcState);
  assert.ok(/value="source" data-change="cfmode" checked/.test(srcHtml));
});

test('import screen works without data and shows the preview when a file is read', () => {
  const empty = render('overview', { ...state, ds: null, calc: null });
  assert.ok(empty.includes('Nhập dữ liệu từ file Excel'));
  const preview = render('import', { ...state, importPreview: ds });
  assert.ok(preview.includes('Thay thế bằng dữ liệu này'));
  assert.ok(preview.includes(fmtInt(ds.payments.length)));
});

test('cloud mode without a signed-in user shows only the sign-in screen', () => {
  const html = render('overview', { ...state, status: { mode: 'cloud', state: 'signed-out' }, user: null });
  assert.ok(html.includes('Đăng nhập bằng Google'));
  assert.ok(!html.includes('Cài đặt ngày và ngưỡng'));
});

test('text from the user is escaped everywhere it is printed', () => {
  assert.equal(esc('<img src=x onerror="a">&'), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;');
  const evil = { ...ds, payments: ds.payments.map((p, i) => (i === 0 ? { ...p, payee: '<script>x</script>' } : p)) };
  const c = runAll(evil, { today: TODAY });
  const html = render('payments', { ...state, ds: evil, calc: c, chain: c, Q: buildQuality(evil, c, c) });
  assert.ok(!html.includes('<script>x</script>'));
});

test('format helpers', () => {
  assert.equal(fmtInt(-0.4), '0');
  assert.equal(fmtInt(1234567.6), '1,234,568');
  assert.equal(fmt2(1234.5), '1,234.50');
  assert.equal(fmtDate('2026-10-05'), '05/10/2026');
  assert.equal(toNum('1,500.5'), 1500.5);
  assert.equal(toNum('1234.5'), 1234.5);
  assert.equal(toNum(''), null);
  assert.equal(toDate('2026-13'), null);
});

test('store reducers update the dataset without mutating the input', () => {
  const base = withDefaults(emptyDataset());
  const next = reduce.upsert(base, 'receipts', { id: 'a', amount: 5 });
  assert.equal(base.receipts.length, 0);
  assert.equal(next.receipts.length, 1);
  const changed = reduce.upsert(next, 'receipts', { id: 'a', amount: 7 });
  assert.equal(changed.receipts[0].amount, 7);
  const removed = reduce.remove(changed, 'receipts', 'a');
  assert.equal(removed.receipts.length, 0);
  const rec = reduce.recon(base, '2026-10-01', { uobVnd: 10 });
  assert.equal(rec.recon['2026-10-01'].uobVnd, 10);
  assert.equal(reduce.settings(base, { minVnd: 1 }).settings.minVnd, 1);
});

test('cashflow filters keep only the chosen weeks, kinds and rows', () => {
  const cf = chain.cashflow;
  const all = filterCashflow(cf, CF_FILTER_DEFAULT);
  assert.equal(all.cols.length, cf.weeks.length);
  assert.equal(all.rows.length, cf.rows.length);

  const range = filterCashflow(cf, { ...CF_FILTER_DEFAULT, from: '1', to: '3' });
  assert.deepEqual(range.cols, [1, 2, 3]);

  const actualOnly = filterCashflow(cf, { ...CF_FILTER_DEFAULT, kind: 'actual' });
  assert.ok(actualOnly.cols.every((i) => cf.weeks[i].actual));
  const forecastOnly = filterCashflow(cf, { ...CF_FILTER_DEFAULT, kind: 'forecast' });
  assert.ok(forecastOnly.cols.every((i) => !cf.weeks[i].actual));

  const summary = filterCashflow(cf, { ...CF_FILTER_DEFAULT, summary: true });
  assert.ok(summary.rows.every((r) => r.type !== 'header'));
  assert.ok(summary.rows.length < cf.rows.length);
  assert.ok(summary.rows.some((r) => r.type === 'ending'));

  const noZero = filterCashflow(cf, { ...CF_FILTER_DEFAULT, hideZero: true });
  assert.ok(noZero.rows.every((r) => r.type === 'header' || r.values.some((v) => Math.abs(Number(v) || 0) >= 0.005)));
  // a section header is kept only when a row under it survives
  noZero.rows.forEach((r, i) => {
    if (r.type === 'header') assert.ok(noZero.rows[i + 1] && noZero.rows[i + 1].type !== 'header');
  });
});

test('cashflow screen shows the filter bar and the filtered table', () => {
  const html = render('cashflow', { ...state, cf: { ...CF_FILTER_DEFAULT, summary: true, from: '0', to: '2' } });
  assert.match(html, /data-field="summary"[^>]*checked/);
  assert.match(html, /data-action="cf-reset"/);
  assert.match(html, /Hiển thị 3\/\d+ tuần/);
  assert.ok(balanced(html, 'table'));
  assert.ok(!html.includes('data-action="cf-toggle"'));
  const none = render('cashflow', { ...state, cf: { ...CF_FILTER_DEFAULT, from: '5', to: '1' } });
  assert.match(none, /Không có tuần nào khớp bộ lọc/);
});

test('cashflow month filter keeps only the weeks of that month', () => {
  const cf = chain.cashflow;
  const july = filterCashflow(cf, { ...CF_FILTER_DEFAULT, month: '7' });
  assert.equal(july.cols.length, 4);
  assert.ok(july.cols.every((i) => cf.weeks[i].code.startsWith('7.')));
  // a month that is entirely forecast combined with the actual-only kind leaves nothing
  assert.equal(filterCashflow(cf, { ...CF_FILTER_DEFAULT, month: '10', kind: 'actual' }).cols.length, 0);
  const html = render('cashflow', { ...state, cf: { ...CF_FILTER_DEFAULT, month: '10' } });
  assert.match(html, /Tháng 10 \(DB\)/);
  assert.match(html, /<option value="10\.1"|>10\.1 \(DB\)/);
  assert.ok(!/>6\.1 \(TT\)/.test(html.split('data-field="from"')[1].split('</select>')[0]));
});

test('cashflow groups fold their items and show the subtotal on the header', () => {
  const cf = chain.cashflow;
  const hdr = cf.rows.find((r) => r.type === 'header' && r.label.includes('RECEIPT'));
  const total = cf.rows.find((r) => r.type === 'sum_receipt');
  const open = filterCashflow(cf, CF_FILTER_DEFAULT);
  assert.ok(open.rows.some((r) => r.type === 'receipt'));
  const folded = filterCashflow(cf, { ...CF_FILTER_DEFAULT, collapsed: { [hdr.row]: true } });
  // items and the TOTAL row of that group are gone; the header now carries the TOTAL numbers
  assert.ok(!folded.rows.some((r) => r.type === 'receipt'));
  assert.ok(!folded.rows.some((r) => r.type === 'sum_receipt'));
  const h = folded.rows.find((r) => r.type === 'header' && r.row === hdr.row);
  assert.equal(h.collapsed, true);
  assert.deepEqual(h.values.slice(0, 3), total.values.slice(0, 3));
  // other groups stay open
  assert.ok(folded.rows.some((r) => r.type === 'payable'));
  // the net / ending lines are never hidden by folding
  assert.ok(folded.rows.some((r) => r.type === 'ending'));
});

test('folding the Others sub-group hides only its own items', () => {
  const cf = chain.cashflow;
  const sub = cf.rows.find((r) => r.type === 'opex_sub');
  const folded = filterCashflow(cf, { ...CF_FILTER_DEFAULT, collapsed: { [sub.row]: true } });
  const shown = folded.rows.find((r) => r.row === sub.row);
  assert.equal(shown.collapsed, true);
  const opexLeaves = folded.rows.filter((r) => r.type === 'opex').length;
  const all = filterCashflow(cf, CF_FILTER_DEFAULT).rows.filter((r) => r.type === 'opex').length;
  assert.ok(opexLeaves < all);
  assert.ok(folded.rows.some((r) => r.type === 'sum_opex'));
});
