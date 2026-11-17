// Data store with one API for two backends:
//  - local: the dataset lives in this browser (localStorage). Used when firebase-config.js is not filled in.
//  - cloud: Firebase Auth (Google) + Firestore; access is authorized by UID/role.
// Every mutation goes through the same pure reducers, so the in-memory dataset updates at once and
// the cloud backend then syncs the same change to Firestore.

export const LOCAL_KEY = 'svl-cashflow-dataset-v1';
const FB_VERSION = '10.12.4';
const FB_APP = `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`;
const FB_AUTH = `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js`;
const FB_FS = `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore.js`;

export const LIST_COLLECTIONS = ['payments', 'receipts', 'fx', 'bankAdj', 'opex', 'accounts'];
export const ALL_COLLECTIONS = [...LIST_COLLECTIONS, 'recon'];

export const DEFAULT_SETTINGS = {
  openingDate: '2026-10-01',
  planStart: null,
  dailyDetailsStart: null,
  planEnd: '2026-12-31',
  forecastStart: null,
  todayOverride: null,
  minVnd: 200000000,
  minUsd: 100000,
  tolVnd: 1000,
  tolUsd: 0.01,
  cfRate: 26300,
  cfSourceLinks: false,
};

export function emptyDataset() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    accounts: [],
    fxDefaults: { sell: 26310, buy: 26250 },
    payments: [],
    receipts: [],
    fx: [],
    bankAdj: [],
    recon: {},
    opex: [],
    categories: [],
    importedAt: null,
  };
}

// Make sure a dataset read from storage or Firestore has every field the engine expects.
export function withDefaults(ds) {
  const base = emptyDataset();
  return {
    ...base,
    ...ds,
    settings: { ...base.settings, ...(ds?.settings || {}) },
    fxDefaults: { ...base.fxDefaults, ...(ds?.fxDefaults || {}) },
    accounts: ds?.accounts || [],
    payments: ds?.payments || [],
    receipts: ds?.receipts || [],
    fx: ds?.fx || [],
    bankAdj: ds?.bankAdj || [],
    opex: ds?.opex || [],
    recon: ds?.recon || {},
  };
}

// ---------- pure reducers (shared by both backends) ----------
export const reduce = {
  settings: (ds, patch) => ({ ...ds, settings: { ...ds.settings, ...patch } }),
  fxDefaults: (ds, patch) => ({ ...ds, fxDefaults: { ...ds.fxDefaults, ...patch } }),
  upsert: (ds, coll, item) => {
    const list = ds[coll] || [];
    const idx = list.findIndex((x) => x.id === item.id);
    const next = idx >= 0 ? list.map((x, i) => (i === idx ? { ...x, ...item } : x)) : [...list, item];
    return { ...ds, [coll]: next };
  },
  remove: (ds, coll, id) => ({ ...ds, [coll]: (ds[coll] || []).filter((x) => x.id !== id) }),
  recon: (ds, date, patch) => ({
    ...ds,
    recon: { ...ds.recon, [date]: { ...(ds.recon?.[date] || {}), ...patch } },
  }),
};

// Firestore document ids cannot contain '/': encode them
const docKey = (id) => encodeURIComponent(String(id));

// ---------- local backend ----------
export function createLocalStore(storage = globalThis.localStorage) {
  let ds = null;
  try {
    const raw = storage?.getItem(LOCAL_KEY);
    ds = raw ? withDefaults(JSON.parse(raw)) : null;
  } catch (e) {
    console.error('Cannot read local data', e);
  }
  const listeners = new Set();
  const status = { mode: 'local', state: ds ? 'ready' : 'empty', message: 'Lưu trên trình duyệt này' };
  const emit = () => listeners.forEach((fn) => fn(ds, status));
  const save = () => {
    try {
      storage?.setItem(LOCAL_KEY, JSON.stringify(ds));
    } catch (e) {
      status.state = 'error';
      status.message = `Không lưu được: ${e.message}`;
    }
  };
  const apply = (next) => {
    ds = next;
    if (ds) save();
    if (ds && status.state !== 'error') status.state = ds.payments.length ? 'ready' : 'empty';
    emit();
  };

  return {
    mode: 'local',
    status,
    get: () => ds,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    auth: null,
    connect() { emit(); },
    async replaceAll(next) { apply({ ...withDefaults(next), importedAt: new Date().toISOString() }); },
    async patchSettings(patch) { apply(reduce.settings(ds || withDefaults(null), patch)); },
    async patchFxDefaults(patch) { apply(reduce.fxDefaults(ds || withDefaults(null), patch)); },
    async upsert(coll, item) { apply(reduce.upsert(ds || withDefaults(null), coll, item)); },
    async remove(coll, id) { apply(reduce.remove(ds, coll, id)); },
    async upsertRecon(date, patch) { apply(reduce.recon(ds || withDefaults(null), date, patch)); },
  };
}

// ---------- cloud backend (Firebase) ----------
export async function createCloudStore(cfg) {
  const [appMod, authMod, fsMod] = await Promise.all([import(FB_APP), import(FB_AUTH), import(FB_FS)]);
  const app = appMod.initializeApp(cfg);
  const auth = authMod.getAuth(app);
  // Financial data: use volatile memory rather than persistent IndexedDB.
  const db = fsMod.initializeFirestore(app, {
    localCache: fsMod.memoryLocalCache(),
  });

  let ds = null;
  const parts = { config: null, ...Object.fromEntries(ALL_COLLECTIONS.map((c) => [c, null])) };
  const listeners = new Set();
  const unsubs = [];
  let memberUnsub = null;
  const status = { mode: 'cloud', role: null, state: 'signed-out', message: 'Chưa đăng nhập' };
  const emit = () => listeners.forEach((fn) => fn(ds, status));

  const assemble = () => {
    const list = (name) => Object.values(parts[name] || {});
    const cfgDoc = parts.config || {};
    return withDefaults({
      settings: cfgDoc.settings,
      fxDefaults: cfgDoc.fxDefaults,
      categories: cfgDoc.categories || [],
      importedAt: cfgDoc.importedAt || null,
      accounts: list('accounts'),
      payments: list('payments'),
      receipts: list('receipts'),
      fx: list('fx'),
      bankAdj: list('bankAdj'),
      opex: list('opex'),
      recon: parts.recon || {},
    });
  };

  const markLoaded = () => {
    const keys = ['config', ...ALL_COLLECTIONS];
    if (keys.every((k) => parts[k] !== null)) {
      ds = assemble();
      status.state = ds.payments.length ? 'ready' : 'empty';
      status.message = 'Đã đồng bộ với đám mây';
    }
    emit();
  };

  const clearData = () => {
    unsubs.splice(0).forEach((unsubscribe) => unsubscribe());
    ds = null;
    Object.keys(parts).forEach((key) => { parts[key] = null; });
  };

  const fail = (err) => {
    clearData(); // A permission error must not leave privileged rows visible.
    status.state = 'error';
    status.message = err?.code === 'permission-denied'
      ? 'Tài khoản chưa được cấp quyền hoặc quyền đã bị thu hồi.'
      : 'Không thể đọc dữ liệu Firebase: ' + (err?.message || String(err));
    emit();
  };

  const requireRole = (roles) => {
    if (!auth.currentUser || !roles.includes(status.role)) {
      throw new Error('Bạn không có quyền thực hiện thao tác này.');
    }
  };

  const listDocs = (snap) => {
    const out = {};
    snap.docs.forEach((d) => { out[d.id] = d.data(); });
    return out;
  };

  const writeDoc = async (coll, id, data) => fsMod.setDoc(fsMod.doc(db, coll, docKey(id)), data);
  const deleteDoc = async (coll, id) => fsMod.deleteDoc(fsMod.doc(db, coll, docKey(id)));

  // Small chunks avoid per-batch security rule document-access limits.
  // This bulk replacement is not atomic across chunks: back up first.
  async function batchWrite(ops) {
    for (let i = 0; i < ops.length; i += 10) {
      const batch = fsMod.writeBatch(db);
      ops.slice(i, i + 10).forEach((op) => op(batch));
      await batch.commit();
    }
  }

  const store = {
    mode: 'cloud',
    status,
    get: () => ds,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    auth: {
      onChange: (fn) => authMod.onAuthStateChanged(auth, fn),
      signIn: () => authMod.signInWithPopup(auth, new authMod.GoogleAuthProvider()),
      signOut: () => authMod.signOut(auth),
    },

    connect() {
      if (memberUnsub) return;
      const user = auth.currentUser;
      if (!user) {
        status.state = 'signed-out';
        status.message = 'Chưa đăng nhập';
        emit();
        return;
      }
      status.state = 'authorizing';
      status.message = 'Đang xác thực quyền Firebase…';
      emit();

      // Roles are issued only from Firebase Console or a trusted admin backend.
      // Listen for revocation and immediately discard all in-memory business data.
      memberUnsub = fsMod.onSnapshot(fsMod.doc(db, 'members', user.uid), (snap) => {
        const nextRole = snap.exists() ? snap.data()?.role : null;
        if (!['viewer', 'editor', 'admin'].includes(nextRole)) {
          clearData();
          status.role = null;
          status.state = 'forbidden';
          status.message = 'Tài khoản chưa được cấp quyền. Liên hệ quản trị Firebase.';
          emit();
          return;
        }
        const roleChanged = nextRole !== status.role;
        status.role = nextRole;
        if (unsubs.length) {
          if (roleChanged) emit();
          return;
        }
        status.state = 'loading';
        status.message = 'Đang tải dữ liệu…';
        emit();
        unsubs.push(fsMod.onSnapshot(fsMod.doc(db, 'config', 'main'), (data) => {
          parts.config = data.exists() ? data.data() : {};
          markLoaded();
        }, fail));
        for (const name of ALL_COLLECTIONS) {
          unsubs.push(fsMod.onSnapshot(fsMod.collection(db, name), (data) => {
            parts[name] = name === 'recon'
              ? Object.fromEntries(data.docs.map((d) => [d.id, d.data()]))
              : listDocs(data);
            markLoaded();
          }, fail));
        }
      }, fail);
    },

    disconnect() {
      if (memberUnsub) { memberUnsub(); memberUnsub = null; }
      clearData();
      status.role = null;
      status.state = 'signed-out';
      status.message = 'Chưa đăng nhập';
      emit();
    },

    async replaceAll(next) {
      requireRole(['admin']);
      const clean = withDefaults(next);
      const importedAt = new Date().toISOString();
      // Delete what is there, then write the new dataset in chunks
      // Delete only documents that will not be written again, so no document gets two writes in one batch
      const keep = {
        ...Object.fromEntries(LIST_COLLECTIONS.map((c) => [c, new Set(clean[c].map((x) => String(x.id)))])),
        recon: new Set(Object.keys(clean.recon)),
      };
      const oldIds = {
        ...Object.fromEntries(LIST_COLLECTIONS.map((c) => [c, (ds?.[c] || []).map((x) => String(x.id))])),
        recon: Object.keys(ds?.recon || {}),
      };
      const ops = [];
      for (const [coll, ids] of Object.entries(oldIds)) {
        for (const id of ids) if (!keep[coll].has(id)) ops.push((b) => b.delete(fsMod.doc(db, coll, docKey(id))));
      }
      for (const coll of LIST_COLLECTIONS) for (const item of clean[coll]) ops.push((b) => b.set(fsMod.doc(db, coll, docKey(item.id)), item));
      for (const [date, row] of Object.entries(clean.recon)) ops.push((b) => b.set(fsMod.doc(db, 'recon', docKey(date)), { ...row, date }));
      ops.push((b) => b.set(fsMod.doc(db, 'config', 'main'), { settings: clean.settings, fxDefaults: clean.fxDefaults, categories: clean.categories, importedAt }));
      await batchWrite(ops);
      ds = { ...clean, importedAt };
      emit();
    },

    async patchSettings(patch) {
      requireRole(['admin']);
      ds = reduce.settings(ds || withDefaults(null), patch);
      emit();
      await fsMod.setDoc(fsMod.doc(db, 'config', 'main'), { settings: ds.settings }, { merge: true });
    },

    async patchFxDefaults(patch) {
      requireRole(['admin']);
      ds = reduce.fxDefaults(ds || withDefaults(null), patch);
      emit();
      await fsMod.setDoc(fsMod.doc(db, 'config', 'main'), { fxDefaults: ds.fxDefaults }, { merge: true });
    },

    async upsert(coll, item) {
      requireRole(['editor', 'admin']);
      if (!LIST_COLLECTIONS.includes(coll)) throw new Error('Tập dữ liệu không hợp lệ.');
      ds = reduce.upsert(ds || withDefaults(null), coll, item);
      emit();
      await writeDoc(coll, item.id, ds[coll].find((x) => x.id === item.id));
    },

    async remove(coll, id) {
      requireRole(['editor', 'admin']);
      if (!LIST_COLLECTIONS.includes(coll)) throw new Error('Tập dữ liệu không hợp lệ.');
      ds = reduce.remove(ds, coll, id);
      emit();
      await deleteDoc(coll, id);
    },

    async upsertRecon(date, patch) {
      requireRole(['editor', 'admin']);
      ds = reduce.recon(ds || withDefaults(null), date, patch);
      emit();
      await writeDoc('recon', date, { ...ds.recon[date], date });
    },
  };
  return store;
}
