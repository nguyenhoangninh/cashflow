// Audit events: one record per accounting change, describing who changed what.
// Records are written by the app with a server timestamp and are append-only in Firestore Rules (audit F05).
// This module only builds and checks the record; it does not write anything.

import { canonicalJson } from './manifest.js';

export const AUDIT_SCHEMA_VERSION = 1;
export const AUDIT_OPERATIONS = ['create', 'update', 'delete', 'import', 'overwrite', 'settings', 'fx-defaults', 'recon'];
export const AUDIT_COLLECTIONS = ['payments', 'receipts', 'fx', 'bankAdj', 'opex', 'accounts', 'recon', 'config'];

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Top-level fields whose value differs between before and after. Missing and null count as equal.
export function changedFields(before, after) {
  const b = isObject(before) ? before : {};
  const a = isObject(after) ? after : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys]
    .filter((k) => canonicalJson(b[k] ?? null) !== canonicalJson(a[k] ?? null))
    .sort();
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));

// Build an audit record. Only the changed fields are copied, so a one-date edit does not copy the whole payment.
export function buildAuditEvent({ actorUid, role, operation, collection, docId, before = null, after = null }) {
  if (typeof actorUid !== 'string' || !actorUid) throw new Error('Thiếu người thực hiện (actorUid).');
  if (!AUDIT_OPERATIONS.includes(operation)) throw new Error(`Thao tác không hợp lệ: ${operation}`);
  if (!AUDIT_COLLECTIONS.includes(collection)) throw new Error(`Tập dữ liệu không hợp lệ: ${collection}`);
  if (typeof docId !== 'string' || !docId) throw new Error('Thiếu mã tài liệu (docId).');
  if (operation === 'create' && before) throw new Error('create không được có bản trước.');
  if (operation === 'delete' && after) throw new Error('delete không được có bản sau.');

  const changed = changedFields(before, after);
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    actorUid,
    role: role ?? null,
    operation,
    collection,
    docId,
    changed,
    before: before ? pick(before, changed) : null,
    after: after ? pick(after, changed) : null,
  };
}
