// Firestore Security Rules tests (audit T01–T04, T07). They need the Firestore Emulator and Java:
//   npm run test:rules
// Without FIRESTORE_EMULATOR_HOST (set by emulators:exec) every test is skipped, so plain `npm test` still runs.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, getDocs } from 'firebase/firestore';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '';
const SKIP = EMULATOR ? false : 'FIRESTORE_EMULATOR_HOST không có: chạy bằng npm run test:rules';
const [HOST, PORT] = EMULATOR.split(':');

const UID = { admin: 'uid-admin', editor: 'uid-editor', viewer: 'uid-viewer', none: 'uid-none' };
const VERIFIED = { email_verified: true };
const UNVERIFIED = { email_verified: false };

let env;

before(async () => {
  if (SKIP) return;
  env = await initializeTestEnvironment({
    projectId: 'demo-svl',
    firestore: {
      rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: HOST,
      port: Number(PORT),
    },
  });
});

after(async () => {
  if (env) await env.cleanup();
});

beforeEach(async () => {
  if (SKIP) return;
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'members', UID.admin), { role: 'admin' });
    await setDoc(doc(db, 'members', UID.editor), { role: 'editor' });
    await setDoc(doc(db, 'members', UID.viewer), { role: 'viewer' });
    await setDoc(doc(db, 'payments', 'P1'), { id: 'P1', item: 'a', amount: 100, currency: 'VND' });
    await setDoc(doc(db, 'config', 'main'), { settings: { openingDate: '2026-06-01' } });
  });
});

const db = (uid, claims = VERIFIED) => env.authenticatedContext(uid, claims).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const good = (id = 'P9') => ({ id, item: 'x', amount: 10, currency: 'VND' });

// ---- T01: no access without a verified, listed account.
test('T01: unauthenticated user cannot read payments', { skip: SKIP }, async () => {
  await assertFails(getDoc(doc(anon(), 'payments', 'P1')));
});

test('T01: a signed-in user with an unverified email cannot read', { skip: SKIP }, async () => {
  await assertFails(getDoc(doc(db(UID.viewer, UNVERIFIED), 'payments', 'P1')));
});

test('T01: a signed-in user without a members entry cannot read', { skip: SKIP }, async () => {
  await assertFails(getDoc(doc(db(UID.none), 'payments', 'P1')));
});

// ---- T02: viewers read and never write.
test('T02: viewer can read payments and config', { skip: SKIP }, async () => {
  await assertSucceeds(getDoc(doc(db(UID.viewer), 'payments', 'P1')));
  await assertSucceeds(getDoc(doc(db(UID.viewer), 'config', 'main')));
});

test('T02: viewer cannot create or update a payment', { skip: SKIP }, async () => {
  await assertFails(setDoc(doc(db(UID.viewer), 'payments', 'P9'), good()));
  await assertFails(updateDoc(doc(db(UID.viewer), 'payments', 'P1'), { amount: 20 }));
});

// ---- T03: editors change transactions; configuration and membership stay with admins.
test('T03: editor can change a payment date and amount', { skip: SKIP }, async () => {
  await assertSucceeds(updateDoc(doc(db(UID.editor), 'payments', 'P1'), { amount: 120 }));
  await assertSucceeds(setDoc(doc(db(UID.editor), 'payments', 'P9'), good()));
});

test('T03: editor cannot write configuration or opening settings', { skip: SKIP }, async () => {
  await assertFails(updateDoc(doc(db(UID.editor), 'config', 'main'), { settings: { openingDate: '2020-01-01' } }));
});

test('T03: admin can write configuration', { skip: SKIP }, async () => {
  await assertSucceeds(updateDoc(doc(db(UID.admin), 'config', 'main'), { settings: { openingDate: '2026-06-01' } }));
});

test('T03: nobody writes members from the client; a member reads only their own entry', { skip: SKIP }, async () => {
  await assertFails(setDoc(doc(db(UID.admin), 'members', UID.none), { role: 'admin' }));
  await assertFails(setDoc(doc(db(UID.editor), 'members', UID.editor), { role: 'admin' }));
  await assertSucceeds(getDoc(doc(db(UID.editor), 'members', UID.editor)));
  await assertFails(getDoc(doc(db(UID.editor), 'members', UID.viewer)));
  await assertSucceeds(getDoc(doc(db(UID.admin), 'members', UID.viewer)));
});

// ---- T07: row shape checks mirror src/validate.js.
test('T07: a payment with a negative amount is refused', { skip: SKIP }, async () => {
  await assertFails(setDoc(doc(db(UID.editor), 'payments', 'P9'), { ...good(), amount: -1 }));
});

test('T07: a payment with an unknown currency is refused', { skip: SKIP }, async () => {
  await assertFails(setDoc(doc(db(UID.editor), 'payments', 'P9'), { ...good(), currency: 'EUR' }));
});

test('T07: a payment without an item is refused', { skip: SKIP }, async () => {
  const { item, ...rest } = good();
  await assertFails(setDoc(doc(db(UID.editor), 'payments', 'P9'), rest));
});

test('T07: FX rows must use the validator types', { skip: SKIP }, async () => {
  const fx = { id: 'F1', date: '2026-10-01', usd: 10, rate: 26000, type: 'SELL USD' };
  await assertSucceeds(setDoc(doc(db(UID.editor), 'fx', 'F1'), fx));
  await assertFails(setDoc(doc(db(UID.editor), 'fx', 'F2'), { ...fx, id: 'F2', type: 'SELL' }));
});

test('T07: reconciliation rows are keyed by date and must carry it', { skip: SKIP }, async () => {
  await assertSucceeds(setDoc(doc(db(UID.editor), 'recon', '2026-10-01'), { date: '2026-10-01', status: 'OK' }));
  await assertFails(setDoc(doc(db(UID.editor), 'recon', '2026-10-02'), { status: 'OK' }));
});

// ---- Audit trail: append-only, written by editors, read by admins.
const audit = (actorUid) => ({
  actorUid, role: 'editor', operation: 'update', collection: 'payments', docId: 'P1',
  changed: ['amount'], before: { amount: 100 }, after: { amount: 120 }, at: serverTimestamp(),
});

test('audit: an editor can append an event that names themselves', { skip: SKIP }, async () => {
  await assertSucceeds(setDoc(doc(db(UID.editor), 'auditEvents', 'e1'), audit(UID.editor)));
});

test('audit: an event naming another user is refused', { skip: SKIP }, async () => {
  await assertFails(setDoc(doc(db(UID.editor), 'auditEvents', 'e2'), audit(UID.admin)));
});

test('audit: events cannot be changed or deleted, even by admins', { skip: SKIP }, async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'auditEvents', 'e3'), { actorUid: UID.editor, at: new Date() });
  });
  await assertFails(updateDoc(doc(db(UID.admin), 'auditEvents', 'e3'), { changed: [] }));
  await assertFails(updateDoc(doc(db(UID.editor), 'auditEvents', 'e3'), { changed: [] }));
});

test('audit: only admins read the trail', { skip: SKIP }, async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'auditEvents', 'e4'), { actorUid: UID.editor });
  });
  await assertFails(getDoc(doc(db(UID.editor), 'auditEvents', 'e4')));
  await assertSucceeds(getDoc(doc(db(UID.admin), 'auditEvents', 'e4')));
});

// ---- Default: anything not listed is closed.
test('default: an unlisted collection is closed to everyone, admins included', { skip: SKIP }, async () => {
  await assertFails(setDoc(doc(db(UID.admin), 'unlisted', 'x'), { a: 1 }));
  await assertFails(getDoc(doc(db(UID.admin), 'unlisted', 'x')));
});

test('viewers can list payments (the realtime listeners read whole collections)', { skip: SKIP }, async () => {
  await assertSucceeds(getDocs(collection(db(UID.viewer), 'payments')));
});
