// Smoke tests for the screens: every view renders from the real dataset, shows the right numbers,
// and keeps its HTML balanced. No browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAll } from '../src/engine.js';
import { buildQuality } from '../src/quality.js';
import { render, TABS } from '../js/views.js';
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
