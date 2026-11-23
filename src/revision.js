// Optimistic concurrency for single-document edits (audit F04).
// Each document carries an integer `rev`. An edit states the rev it was based on; if the server holds a
// different rev, the edit is a conflict and must not overwrite the other change. Pure functions.

export const REV_FIELD = 'rev';
export const UPDATED_BY_FIELD = 'updatedBy';

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// A document written before revisions existed has no rev; it counts as 0.
export const revOf = (doc) => (isObject(doc) && Number.isInteger(doc[REV_FIELD]) ? doc[REV_FIELD] : 0);

// Build the update for a single document: only the changed fields, plus the new rev and the editor.
// The id can never change through an edit. The store must send `expectedRev` as a precondition.
export function buildFieldPatch(current, changes, { actorUid } = {}) {
  if (!isObject(current)) throw new Error('Không có bản hiện tại để sửa.');
  if (!isObject(changes) || Object.keys(changes).length === 0) throw new Error('Không có trường nào để cập nhật.');
  if (typeof actorUid !== 'string' || !actorUid) throw new Error('Thiếu người thực hiện (actorUid).');
  for (const forbidden of ['id', REV_FIELD, UPDATED_BY_FIELD]) {
    if (forbidden in changes) throw new Error(`Không được sửa trường "${forbidden}" bằng cách này.`);
  }
  const expectedRev = revOf(current);
  const changed = Object.keys(changes).filter((k) => JSON.stringify(current[k] ?? null) !== JSON.stringify(changes[k] ?? null));
  if (changed.length === 0) return { changed: [], expectedRev, update: null };
  return {
    changed,
    expectedRev,
    update: { ...Object.fromEntries(changed.map((k) => [k, changes[k]])), [REV_FIELD]: expectedRev + 1, [UPDATED_BY_FIELD]: actorUid },
  };
}

// True when the document on the server is not the revision the edit was based on.
export function isConflict(serverDoc, expectedRev) {
  return revOf(serverDoc) !== expectedRev;
}

// Message for the user when an edit conflicts. It names the fields that differ, so the user can decide.
export function conflictMessage(serverDoc, localChanges) {
  const fields = Object.keys(localChanges || {}).filter((k) => JSON.stringify(serverDoc?.[k] ?? null) !== JSON.stringify(localChanges[k] ?? null));
  const who = serverDoc?.[UPDATED_BY_FIELD] ? ` bởi ${serverDoc[UPDATED_BY_FIELD]}` : '';
  return `Dữ liệu đã được sửa${who}. Trường khác biệt: ${fields.join(', ') || '(không rõ)'}. Tải lại trước khi lưu.`;
}
