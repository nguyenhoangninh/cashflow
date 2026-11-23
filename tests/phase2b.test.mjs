// Phase 2 planning code: staged import, read-back check, activation and rollback plans, and revisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareStaging, chunkWrites, checkStagedVersion, activationPlan, rollbackPlan,
  versionDocPath, versionDataPath, assertVersionId, WRITE_BATCH_LIMIT,
} from '../src/staging.js';
import { buildManifest } from '../src/manifest.js';
import { revOf, buildFieldPatch, isConflict, conflictMessage } from '../src/revision.js';

const V = 'v-2026-11-23-a';

const sample = () => ({
  settings: { openingDate: '2026-06-01' },
  fxDefaults: { sell: 26310, buy: 26250 },
  cashflowOpening: 1680.8,
  cashflowActuals: { 8: [1, 2] },
  payments: [
    { id: 'P1', item: 'a', amount: 100, currency: 'VND' },
    { id: 'P/2', item: 'b', amount: 50, currency: 'USD' },
  ],
  receipts: [{ id: 'R1', date: '2026-10-01', amount: 300, currency: 'VND' }],
  fx: [{ id: 'F1', date: '2026-10-01', usd: 10, rate: 26000, type: 'SELL USD' }],
  bankAdj: [],
  opex: [{ id: 'O1', vndMonth: 1 }],
  accounts: [{ id: 'A1', currency: 'VND', balance: 9 }],
  recon: { '2026-10-01': { status: 'OK' } },
});

// Simulate what the store would read back for a staged version.
function readBackOf(ds, meta) {
  return {
    meta,
    config: { settings: ds.settings, fxDefaults: ds.fxDefaults, cashflowOpening: ds.cashflowOpening, cashflowActuals: ds.cashflowActuals },
    rows: { payments: ds.payments, receipts: ds.receipts, fx: ds.fx, bankAdj: ds.bankAdj, opex: ds.opex, accounts: ds.accounts, recon: ds.recon },
  };
}

test('version ids are checked before anything is written', () => {
  assert.equal(assertVersionId('v-2026-11-23-a'), 'v-2026-11-23-a');
  assert.throws(() => assertVersionId('Bad Id'), /không hợp lệ/);
  assert.throws(() => assertVersionId('short'), /không hợp lệ/);
  assert.throws(() => assertVersionId('../../config/main'), /không hợp lệ/);
});

test('staging writes a meta doc, a config doc, one doc per row and one per recon date', async () => {
  const { manifest, writes } = await prepareStaging(sample(), V);
  assert.equal(manifest.counts.payments, 2);
  const paths = writes.map((w) => w.path);
  assert.ok(paths.includes(versionDocPath(V)));
  assert.ok(paths.includes(`${versionDocPath(V)}/config/main`));
  assert.ok(paths.includes(versionDataPath(V, 'payments', 'P1')));
  // The id "P/2" is encoded the same way the live store encodes it.
  assert.ok(paths.includes(`datasets/${V}/payments/P%2F2`));
  assert.ok(paths.includes(versionDataPath(V, 'recon', '2026-10-01')));
  // Nothing is written to the live paths.
  assert.ok(paths.every((p) => p.startsWith('datasets/')));
});

test('staging refuses a missing or duplicate id, so no partial copy is written', async () => {
  const dup = sample();
  dup.payments.push({ id: 'P1', item: 'again', amount: 1, currency: 'VND' });
  await assert.rejects(prepareStaging(dup, V), /Mã trùng trong payments: P1/);
  const missing = sample();
  missing.receipts.push({ amount: 1, currency: 'VND' });
  await assert.rejects(prepareStaging(missing, V), /thiếu mã/);
});

test('chunks respect the batch limit and keep every write', async () => {
  const ds = sample();
  ds.payments = Array.from({ length: 2277 }, (_, i) => ({ id: `Q${i}`, item: 'x', amount: 1, currency: 'VND' }));
  const { writes } = await prepareStaging(ds, V);
  const chunks = chunkWrites(writes);
  assert.ok(chunks.every((c) => c.length <= WRITE_BATCH_LIMIT));
  assert.equal(chunks.flat().length, writes.length);
  assert.throws(() => chunkWrites(writes, 0), /không hợp lệ/);
});

test('a complete read-back of a staged version passes the check', async () => {
  const ds = sample();
  const { manifest } = await prepareStaging(ds, V);
  const res = await checkStagedVersion(readBackOf(ds, { status: 'staged', manifest }));
  assert.equal(res.ok, true, res.mismatches?.join('; '));
});

test('a read-back with a missing row fails the check with the reason', async () => {
  const ds = sample();
  const { manifest } = await prepareStaging(ds, V);
  const short = { ...ds, payments: [ds.payments[0]] };
  const res = await checkStagedVersion(readBackOf(short, { status: 'staged', manifest }));
  assert.equal(res.ok, false);
  assert.ok(res.mismatches.some((m) => m.includes('số dòng payments')));
});

test('a version that is not staged cannot be checked for activation', async () => {
  const ds = sample();
  const { manifest } = await prepareStaging(ds, V);
  const res = await checkStagedVersion(readBackOf(ds, { status: 'active', manifest }));
  assert.equal(res.ok, false);
  assert.ok(res.mismatches[0].includes('staged'));
});

test('activation is conditional on the current active version and retires the previous one', () => {
  const first = activationPlan(V, null);
  assert.deepEqual(first.precondition, { activeVersion: null });
  assert.equal(first.ops.length, 2);

  const OLD = 'v-2026-10-01-z';
  const second = activationPlan(V, OLD);
  assert.deepEqual(second.precondition, { activeVersion: OLD });
  const retire = second.ops.find((o) => o.path === versionDocPath(OLD));
  assert.deepEqual(retire.update, { status: 'retired' });
  const pointer = second.ops.find((o) => o.path === 'config/active');
  assert.equal(pointer.data.activeVersion, V);
  assert.equal(pointer.data.previousVersion, OLD);
});

test('rollback swaps the pointer back and retires the current version', () => {
  const plan = rollbackPlan(V, 'v-2026-10-01-z');
  const pointer = plan.ops.find((o) => o.path === 'config/active');
  assert.equal(pointer.data.activeVersion, 'v-2026-10-01-z');
  assert.deepEqual(plan.precondition, { activeVersion: V });
  const retired = plan.ops.find((o) => o.path === versionDocPath(V));
  assert.deepEqual(retired.update, { status: 'retired' });
});

test('staged version ids of the manifest agree with a fresh manifest of the same data', async () => {
  const ds = sample();
  const { manifest } = await prepareStaging(ds, V);
  assert.deepEqual(manifest, await buildManifest(ds));
});

test('revision: a document without rev counts as 0 and a patch bumps it', () => {
  assert.equal(revOf({ id: 'P1' }), 0);
  const patch = buildFieldPatch({ id: 'P1', dueDate: '2026-11-01', amount: 5 }, { dueDate: '2026-11-05' }, { actorUid: 'uid-e' });
  assert.deepEqual(patch.changed, ['dueDate']);
  assert.equal(patch.expectedRev, 0);
  assert.deepEqual(patch.update, { dueDate: '2026-11-05', rev: 1, updatedBy: 'uid-e' });
});

test('revision: a patch with no real change produces no write', () => {
  const patch = buildFieldPatch({ id: 'P1', dueDate: '2026-11-01' }, { dueDate: '2026-11-01' }, { actorUid: 'u' });
  assert.equal(patch.update, null);
  assert.deepEqual(patch.changed, []);
});

test('revision: id, rev and updatedBy cannot be changed through a patch', () => {
  const cur = { id: 'P1', rev: 3, dueDate: 'x' };
  assert.throws(() => buildFieldPatch(cur, { id: 'P9' }, { actorUid: 'u' }), /id/);
  assert.throws(() => buildFieldPatch(cur, { rev: 0 }, { actorUid: 'u' }), /rev/);
  assert.throws(() => buildFieldPatch(cur, { updatedBy: 'x' }, { actorUid: 'u' }), /updatedBy/);
  assert.throws(() => buildFieldPatch(cur, { dueDate: 'y' }, {}), /actorUid/);
});

test('revision: a conflict is detected and the message names the differing fields', () => {
  const server = { id: 'P1', rev: 4, dueDate: '2026-11-09', amount: 100, updatedBy: 'uid-other' };
  assert.equal(isConflict(server, 3), true);
  assert.equal(isConflict(server, 4), false);
  const msg = conflictMessage(server, { dueDate: '2026-11-05', amount: 100 });
  assert.ok(msg.includes('dueDate'));
  assert.ok(!msg.includes('amount'));
  assert.ok(msg.includes('uid-other'));
});
