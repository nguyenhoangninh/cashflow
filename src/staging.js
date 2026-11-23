// Staged import: write a complete copy of a dataset under a version id, read it back and check it against
// its manifest, and only then move the active pointer to it. This file only plans the writes and checks
// the result. The store performs the writes (audit F03/F08). Pure functions, no Firebase.

import { buildManifest, verifyManifest } from './manifest.js';

export const STAGING_COLLECTIONS = ['payments', 'receipts', 'fx', 'bankAdj', 'opex', 'accounts', 'recon'];
// Firestore accepts up to 500 operations per batch. Stay well below it.
export const WRITE_BATCH_LIMIT = 400;

const VERSION_RE = /^[a-z0-9][a-z0-9-]{7,63}$/;

export function assertVersionId(versionId) {
  if (typeof versionId !== 'string' || !VERSION_RE.test(versionId)) {
    throw new Error('Mã phiên bản dữ liệu không hợp lệ (chỉ chữ thường, số và dấu gạch ngang, 8–64 ký tự).');
  }
  return versionId;
}

// Same encoding as js/store.js docKey, so a staged document has the same id as the live one.
const docKey = (id) => encodeURIComponent(String(id));

export const versionDocPath = (versionId) => `datasets/${versionId}`;
export const versionDataPath = (versionId, coll, id) => `datasets/${versionId}/${coll}/${docKey(id)}`;

// Build every write needed to stage a dataset. Throws on a missing or duplicate id, so a bad file
// never reaches Firestore as a partial copy.
export async function prepareStaging(ds, versionId) {
  assertVersionId(versionId);
  const manifest = await buildManifest(ds);
  const writes = [];

  writes.push({ path: versionDocPath(versionId), data: { status: 'staged', manifest } });
  writes.push({
    path: `${versionDocPath(versionId)}/config/main`,
    data: {
      settings: ds.settings ?? null,
      fxDefaults: ds.fxDefaults ?? null,
      cashflowOpening: ds.cashflowOpening ?? null,
      cashflowOpeningStored: ds.cashflowOpeningStored ?? {},
      cashflowActuals: ds.cashflowActuals ?? {},
    },
  });

  for (const coll of STAGING_COLLECTIONS) {
    if (coll === 'recon') {
      for (const [date, row] of Object.entries(ds.recon || {})) {
        writes.push({ path: versionDataPath(versionId, coll, date), data: { ...row, date } });
      }
      continue;
    }
    const seen = new Set();
    for (const row of ds[coll] || []) {
      if (row.id === undefined || row.id === null || String(row.id) === '') {
        throw new Error(`Dòng thiếu mã (id) trong ${coll}.`);
      }
      const key = String(row.id);
      if (seen.has(key)) throw new Error(`Mã trùng trong ${coll}: ${key}`);
      seen.add(key);
      writes.push({ path: versionDataPath(versionId, coll, row.id), data: row });
    }
  }
  return { manifest, writes };
}

// Split writes into batches that respect the Firestore limit.
export function chunkWrites(writes, size = WRITE_BATCH_LIMIT) {
  if (!Number.isInteger(size) || size < 1) throw new Error('Kích thước lô không hợp lệ.');
  const out = [];
  for (let i = 0; i < writes.length; i += size) out.push(writes.slice(i, i + size));
  return out;
}

// Read-back check: the staged version must be marked staged, and what was read back must match its manifest.
// `readBack` is { meta, config, rows } where rows is { payments: [...], ... } and recon is { date: row }.
export async function checkStagedVersion(readBack) {
  const { meta, config, rows } = readBack || {};
  if (!meta || meta.status !== 'staged') {
    return { ok: false, mismatches: [`trạng thái phiên bản là "${meta?.status ?? 'không có'}", cần "staged"`] };
  }
  const ds = {
    settings: config?.settings ?? null,
    fxDefaults: config?.fxDefaults ?? null,
    cashflowOpening: config?.cashflowOpening ?? null,
    cashflowOpeningStored: config?.cashflowOpeningStored ?? {},
    cashflowActuals: config?.cashflowActuals ?? {},
    recon: rows?.recon ?? {},
    ...Object.fromEntries(STAGING_COLLECTIONS.filter((c) => c !== 'recon').map((c) => [c, rows?.[c] ?? []])),
  };
  return verifyManifest(ds, meta.manifest);
}

// Activation is a transaction: it runs only if the active pointer still names `expectedActive`.
// It marks the new version active and the previous one retired. Rollback is the same call in reverse.
export function activationPlan(versionId, expectedActive) {
  assertVersionId(versionId);
  if (expectedActive !== null && expectedActive !== undefined) assertVersionId(expectedActive);
  const previous = expectedActive ?? null;
  const ops = [
    { path: 'config/active', data: { activeVersion: versionId, previousVersion: previous }, precondition: { activeVersion: previous } },
    { path: versionDocPath(versionId), update: { status: 'active' } },
  ];
  if (previous) ops.push({ path: versionDocPath(previous), update: { status: 'retired' } });
  return { ops, precondition: { activeVersion: previous } };
}

export function rollbackPlan(currentVersion, previousVersion) {
  assertVersionId(currentVersion);
  assertVersionId(previousVersion);
  return activationPlan(previousVersion, currentVersion);
}
