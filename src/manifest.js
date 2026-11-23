// Manifest of a dataset: row counts, totals per currency and a checksum.
// A staged import is compared with its manifest before it can become the active data (audit F03/F08).
// Pure functions: no Firebase and no DOM, so they run in the browser and in node --test.

export const MANIFEST_VERSION = 1;

const LIST_COLLECTIONS = ['payments', 'receipts', 'fx', 'bankAdj', 'opex', 'accounts'];
// Collections whose "amount" is money and should be totalled per currency.
const MONEY_COLLECTIONS = ['payments', 'receipts', 'bankAdj'];

const round2 = (x) => Math.round(x * 100) / 100;

// Stable JSON: object keys sorted at every level, so key order never changes the checksum.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

// The data that counts toward the checksum. Metadata such as importedAt or dataStatus is left out on purpose.
export function datasetPayload(ds = {}) {
  const payload = {
    settings: ds.settings ?? null,
    fxDefaults: ds.fxDefaults ?? null,
    cashflowOpening: ds.cashflowOpening ?? null,
    cashflowActuals: ds.cashflowActuals ?? {},
    recon: ds.recon ?? {},
  };
  for (const coll of LIST_COLLECTIONS) {
    payload[coll] = [...(ds[coll] || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return payload;
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checksumOf(ds) {
  return sha256Hex(canonicalJson(datasetPayload(ds)));
}

// Totals of the amount column per currency. A blank currency gets its own bucket so it is visible.
export function totalsByCurrency(ds = {}) {
  const out = {};
  for (const coll of MONEY_COLLECTIONS) {
    const byCur = {};
    for (const row of ds[coll] || []) {
      const cur = row.currency ? String(row.currency) : '(trống)';
      byCur[cur] = (byCur[cur] || 0) + (Number(row.amount) || 0);
    }
    out[coll] = Object.fromEntries(Object.entries(byCur).map(([k, v]) => [k, round2(v)]));
  }
  return out;
}

export function countsOf(ds = {}) {
  const counts = Object.fromEntries(LIST_COLLECTIONS.map((c) => [c, (ds[c] || []).length]));
  counts.recon = Object.keys(ds.recon || {}).length;
  return counts;
}

export async function buildManifest(ds) {
  return {
    manifestVersion: MANIFEST_VERSION,
    counts: countsOf(ds),
    totals: totalsByCurrency(ds),
    checksum: await checksumOf(ds),
  };
}

// Compare a dataset with an expected manifest. Returns every mismatch, not just the first.
export async function verifyManifest(ds, expected) {
  if (!expected || expected.manifestVersion !== MANIFEST_VERSION) {
    return { ok: false, mismatches: ['manifest: phiên bản không hợp lệ hoặc thiếu'] };
  }
  const actual = await buildManifest(ds);
  const mismatches = [];
  for (const key of new Set([...Object.keys(expected.counts || {}), ...Object.keys(actual.counts)])) {
    if ((expected.counts || {})[key] !== actual.counts[key]) {
      mismatches.push(`số dòng ${key}: mong đợi ${(expected.counts || {})[key]}, có ${actual.counts[key]}`);
    }
  }
  for (const coll of MONEY_COLLECTIONS) {
    const exp = (expected.totals || {})[coll] || {};
    const act = actual.totals[coll] || {};
    for (const cur of new Set([...Object.keys(exp), ...Object.keys(act)])) {
      if (exp[cur] !== act[cur]) {
        mismatches.push(`tổng ${coll} ${cur}: mong đợi ${exp[cur] ?? 0}, có ${act[cur] ?? 0}`);
      }
    }
  }
  if (expected.checksum !== actual.checksum) mismatches.push('checksum không khớp');
  return { ok: mismatches.length === 0, mismatches, actual };
}
