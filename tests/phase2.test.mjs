// Phase 2 building blocks: dataset manifest (counts, totals, checksum) and audit records.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildManifest, verifyManifest, checksumOf, totalsByCurrency, canonicalJson,
} from '../src/manifest.js';
import { buildAuditEvent, changedFields, AUDIT_SCHEMA_VERSION } from '../src/audit.js';

const sample = () => ({
  settings: { openingDate: '2026-06-01', minVnd: 1000 },
  fxDefaults: { sell: 26310, buy: 26250 },
  cashflowOpening: 1680.8,
  cashflowActuals: { '8': [1, 2, 3] },
  payments: [
    { id: 'P2', item: 'b', amount: 200, currency: 'USD' },
    { id: 'P1', item: 'a', amount: 100.1, currency: 'VND' },
    { id: 'P3', item: 'c', amount: 50, currency: '' },
  ],
  receipts: [{ id: 'R1', amount: 300, currency: 'VND' }],
  fx: [{ id: 'F1', usd: 10, rate: 26000, vnd: 260000 }],
  bankAdj: [{ id: 'B1', amount: 5, currency: 'USD', direction: 'IN' }],
  opex: [{ id: 'O1', vndMonth: 1 }],
  accounts: [{ id: 'A1', currency: 'VND', balance: 9 }],
  recon: { '2026-10-01': { status: 'OK' } },
  importedAt: '2026-11-22T04:00:00.000Z',
});

test('canonicalJson sorts keys at every level', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test('checksum does not depend on key order or on metadata such as importedAt', async () => {
  const a = sample();
  const b = { ...sample(), importedAt: '2030-01-01T00:00:00.000Z' };
  b.payments = [...sample().payments].reverse();
  b.payments = b.payments.map((p) => Object.fromEntries(Object.entries(p).reverse()));
  assert.equal(await checksumOf(a), await checksumOf(b));
});

test('checksum changes when one amount changes', async () => {
  const a = sample();
  const b = sample();
  b.payments[1].amount = 100.2;
  assert.notEqual(await checksumOf(a), await checksumOf(b));
});

test('totals are per currency, with a visible bucket for a blank currency', () => {
  const t = totalsByCurrency(sample());
  assert.deepEqual(t.payments, { VND: 100.1, USD: 200, '(trống)': 50 });
  assert.deepEqual(t.receipts, { VND: 300 });
  assert.deepEqual(t.bankAdj, { USD: 5 });
});

test('manifest matches its own dataset and reports no mismatch', async () => {
  const ds = sample();
  const m = await buildManifest(ds);
  assert.equal(m.counts.payments, 3);
  assert.equal(m.counts.recon, 1);
  const v = await verifyManifest(ds, m);
  assert.equal(v.ok, true);
  assert.deepEqual(v.mismatches, []);
});

test('verify lists every mismatch: a dropped row, a changed total and a changed checksum', async () => {
  const m = await buildManifest(sample());
  const broken = sample();
  broken.payments = broken.payments.filter((p) => p.id !== 'P1');
  const v = await verifyManifest(broken, m);
  assert.equal(v.ok, false);
  assert.ok(v.mismatches.some((x) => x.includes('số dòng payments')), v.mismatches.join('; '));
  assert.ok(v.mismatches.some((x) => x.includes('tổng payments VND')), v.mismatches.join('; '));
  assert.ok(v.mismatches.includes('checksum không khớp'));
});

test('verify rejects a missing or unknown manifest version', async () => {
  assert.equal((await verifyManifest(sample(), null)).ok, false);
  assert.equal((await verifyManifest(sample(), { manifestVersion: 99 })).ok, false);
});

test('manifest of the workbook fixture is internally consistent (when fixtures exist)', async (t) => {
  const path = new URL('../fixtures/dataset.json', import.meta.url);
  if (!fs.existsSync(path)) return t.skip('fixtures/dataset.json không có trong bản công khai');
  const ds = JSON.parse(fs.readFileSync(path, 'utf8'));
  const m = await buildManifest(ds);
  assert.equal(m.counts.payments, ds.payments.length);
  assert.equal((await verifyManifest(ds, m)).ok, true);
  for (const coll of Object.keys(m.totals)) {
    for (const v of Object.values(m.totals[coll])) assert.ok(Number.isFinite(v), `${coll} total is finite`);
  }
});

test('changedFields treats a missing field and null as equal', () => {
  assert.deepEqual(changedFields({ a: 1, b: null }, { a: 1 }), []);
  assert.deepEqual(changedFields({ a: 1, b: 2 }, { a: 1, b: 3, c: 'x' }), ['b', 'c']);
});

test('audit update records only the changed fields, not the whole document', () => {
  const ev = buildAuditEvent({
    actorUid: 'uid-editor', role: 'editor', operation: 'update', collection: 'payments', docId: 'P1',
    before: { id: 'P1', item: 'a', amount: 100, dueDate: '2026-11-01' },
    after: { id: 'P1', item: 'a', amount: 100, dueDate: '2026-11-05' },
  });
  assert.equal(ev.schemaVersion, AUDIT_SCHEMA_VERSION);
  assert.deepEqual(ev.changed, ['dueDate']);
  assert.deepEqual(ev.before, { dueDate: '2026-11-01' });
  assert.deepEqual(ev.after, { dueDate: '2026-11-05' });
});

test('audit create and delete record the document on one side only', () => {
  const c = buildAuditEvent({ actorUid: 'u', operation: 'create', collection: 'receipts', docId: 'R9', after: { id: 'R9', amount: 1 } });
  assert.equal(c.before, null);
  assert.deepEqual(c.changed, ['amount', 'id']);
  const d = buildAuditEvent({ actorUid: 'u', operation: 'delete', collection: 'receipts', docId: 'R9', before: { id: 'R9', amount: 1 } });
  assert.equal(d.after, null);
});

test('audit rejects invalid input', () => {
  const base = { actorUid: 'u', operation: 'update', collection: 'payments', docId: 'P1', before: {}, after: {} };
  assert.throws(() => buildAuditEvent({ ...base, actorUid: '' }), /actorUid/);
  assert.throws(() => buildAuditEvent({ ...base, operation: 'drop' }), /Thao tác/);
  assert.throws(() => buildAuditEvent({ ...base, collection: 'members' }), /Tập dữ liệu/);
  assert.throws(() => buildAuditEvent({ ...base, docId: '' }), /docId/);
  assert.throws(() => buildAuditEvent({ ...base, operation: 'create' }), /create/);
  assert.throws(() => buildAuditEvent({ ...base, operation: 'delete', after: {} }), /delete/);
});
