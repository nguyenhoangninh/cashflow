// Entry point: connects the store (local or Firebase), the engine and the screens.
import { runAll, todayKey } from '../src/engine.js';
import { buildQuality } from '../src/quality.js';
import { importWorkbook } from '../src/importer.js';
import { buildAiPackage } from '../src/ai-export.js';
import { createLocalStore, createCloudStore } from './store.js';
import { render, CF_FILTER_DEFAULT } from './views.js';
import { toNum, toText, toDate } from './format.js';
import { firebaseConfig } from '../firebase-config.js';

const app = document.getElementById('app');
let store = null;

const state = {
  view: (location.hash || '').slice(1) || 'overview',
  ds: null,
  calc: null,
  chain: null,
  Q: null,
  pay: { q: '', include: '', cur: '', cat: '', page: 0 },
  cf: { ...CF_FILTER_DEFAULT },
  dayKey: null,
  importPreview: null,
  importStatus: '',
  message: '',
  messageKind: '',
  status: { mode: 'local', state: 'empty', message: '' },
  user: null,
};

// ---------- calculations ----------
function recalc(ds) {
  if (!ds) return { ds: null, calc: null, chain: null, Q: null };
  const today = ds.settings.todayOverride || todayKey();
  const chain = runAll(ds, { today });
  const source = runAll(ds, { today, sourceOpeningLinks: true });
  const calc = ds.settings.cfSourceLinks ? source : chain;
  const Q = buildQuality(ds, chain, source);
  return { ds, calc, chain, Q };
}

// ---------- rendering ----------
function paint() {
  app.innerHTML = render(state.view, state);
  if (state.ds && state.calc && !state.calc.plan?.error) {
    const heading = app.querySelector('.page-title');
    if (heading) {
      const actions = document.createElement('div');
      actions.className = 'ai-tools';
      actions.innerHTML = '<span class="muted small">AI: chỉ tải về, không tự gửi dữ liệu</span>'
        + '<button type="button" data-action="ai-export-summary">Xuất AI tổng hợp</button>'
        + '<button type="button" data-action="ai-export-detail">Xuất AI chi tiết</button>';
      heading.appendChild(actions);
    }
  }
  // Disable edit controls for read-only viewers. Firestore rules are the
  // enforcement boundary; these UI safeguards avoid accidental edit attempts.
  const cloudRole = state.status?.mode === 'cloud' ? state.status.role : null;
  if (cloudRole === 'viewer' || cloudRole === 'editor') {
    const mutable = [
      '[data-change="pay"]', '[data-change="recon"]', '[data-change="acct"]',
      '[data-change="opex"]', '[data-action="crud-del"]',
      '[data-action="pay-resolve"]', '[data-action="fx-suggest"]',
      'form[data-form] input', 'form[data-form] select', 'form[data-form] button',
    ];
    if (cloudRole === 'viewer') {
      app.querySelectorAll(mutable.join(',')).forEach((el) => { el.disabled = true; });
    }
    app.querySelectorAll('[data-change="cfmode"],[data-change="import-file"],[data-action="import-confirm"]')
      .forEach((el) => { el.disabled = true; });
    if (cloudRole === 'editor') {
      app.querySelectorAll('form[data-form="settings"] :is(input, select, button), form[data-form="fxdef"] :is(input, select, button)')
        .forEach((el) => { el.disabled = true; });
    }
  }
  document.title = `SVL Dự báo dòng tiền — ${TITLES[state.view] || ''}`.trim();
}
const TITLES = {
  overview: 'Tổng quan', plan: 'Kế hoạch ngày', details: 'Chi tiết ngày', payments: 'Thanh toán',
  receipts: 'Thu', fx: 'Giao dịch FX', bank: 'Điều chỉnh NH', recon: 'Đối chiếu', accounts: 'Số dư đầu',
  weekly: 'Kế hoạch tuần', cashflow: 'Dòng tiền', opex: 'Opex', quality: 'Kiểm tra dữ liệu', import: 'Nhập file', settings: 'Cài đặt',
};

function setMessage(text, kind = '') {
  state.message = text;
  state.messageKind = kind;
}

function onStore(ds, status) {
  Object.assign(state, recalc(ds));
  state.status = { ...status };
  paint();
}

// ---------- helpers ----------
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Reads a form into an object: data-type="date" -> ISO string or null, data-type="number" -> number or null, else text
function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    const t = el.dataset.type;
    if (t === 'date') out[el.name] = toDate(el.value);
    else if (t === 'number') out[el.name] = toNum(el.value);
    else out[el.name] = toText(el.value) || null;
  }
  return out;
}

// ---------- event handlers ----------
async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  try {
    switch (action) {
      case 'nav':
        state.view = el.dataset.view;
        location.hash = state.view;
        setMessage('');
        paint();
        window.scrollTo(0, 0);
        break;

      case 'ai-export-summary':
      case 'ai-export-detail': {
        if (!state.ds || !state.calc) throw new Error('Chưa có dữ liệu Cashflow.');
        const level = action === 'ai-export-detail' ? 'detail' : 'summary';
        const note = level === 'detail'
          ? 'File có danh sách chi tiết khoản thanh toán, nhưng không chứa tên đối tác và số tài khoản.'
          : 'File chỉ có số liệu tổng hợp và cảnh báo dòng tiền.';
        if (!window.confirm(note + '\\n\\nĐây là dữ liệu tài chính nội bộ SVL. Chỉ chia sẻ nếu được công ty cho phép. Tải file về?')) break;
        const pack = buildAiPackage(state.ds, state.calc, state.Q, { level });
        const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'SVL_Cashflow_AI_' + level + '_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        setMessage('Đã tải file về máy; chưa tự động gửi dữ liệu tới ChatGPT.', 'ok');
        paint();
        break;
      }

      case 'pay-page':
        state.pay.page = Math.max(0, (state.pay.page || 0) + Number(el.dataset.dir));
        paint();
        break;

      case 'cf-reset':
        // resets the filters only; folded groups and the chart strip stay as they are
        state.cf = { ...CF_FILTER_DEFAULT, collapsed: state.cf.collapsed, charts: state.cf.charts };
        paint();
        break;

      case 'cf-charts':
        state.cf = { ...state.cf, charts: !state.cf.charts };
        paint();
        break;

      case 'cf-toggle': {
        const key = el.dataset.key;
        const collapsed = { ...state.cf.collapsed };
        if (collapsed[key]) delete collapsed[key]; else collapsed[key] = true;
        state.cf = { ...state.cf, collapsed };
        paint();
        break;
      }

      case 'cf-collapse-all':
        state.cf = {
          ...state.cf,
          collapsed: Object.fromEntries(state.calc.cashflow.rows
            .filter((r) => r.type === 'header' || r.type === 'opex_sub')
            .map((r) => [r.row, true])),
        };
        paint();
        break;

      case 'cf-expand-all':
        state.cf = { ...state.cf, collapsed: {} };
        paint();
        break;

      case 'pay-resolve': {
        const p = state.ds.payments.find((x) => x.id === el.dataset.id);
        if (p) await store.upsert('payments', { id: p.id, issueResolved: !p.issueResolved });
        break;
      }

      case 'fx-suggest': {
        const usd = Number(el.dataset.usd);
        const rate = Number(el.dataset.rate);
        const kind = el.dataset.kind;
        if (!window.confirm(`Thêm giao dịch ${kind} ${usd.toLocaleString('vi-VN')} USD tại tỷ giá ${rate} (ngày ${el.dataset.date})?`)) break;
        await store.upsert('fx', {
          id: newId('fx'), date: el.dataset.date, type: kind, usd, rate,
          vnd: Math.round(usd * rate), bank: '', ref: 'Gợi ý từ Kế hoạch ngày', notes: '',
        });
        setMessage('Đã thêm giao dịch FX.', 'ok');
        paint();
        break;
      }

      case 'crud-del':
        if (window.confirm('Xóa dòng này?')) await store.remove(el.dataset.coll, el.dataset.id);
        break;

      case 'login':
        await store.auth.signIn();
        break;

      case 'logout':
        await store.auth.signOut();
        break;

      case 'import-confirm': {
        const prev = state.ds?.settings || {};
        const next = state.importPreview;
        next.settings = { ...next.settings, cfSourceLinks: !!prev.cfSourceLinks, todayOverride: prev.todayOverride ?? null };
        await store.replaceAll(next);
        state.importPreview = null;
        state.importStatus = '';
        setMessage('Đã nhập dữ liệu từ file Excel.', 'ok');
        state.view = 'overview';
        location.hash = 'overview';
        paint();
        break;
      }

      case 'import-cancel':
        state.importPreview = null;
        state.importStatus = '';
        paint();
        break;

      default:
        break;
    }
  } catch (err) {
    console.error(err);
    setMessage(`Lỗi: ${err.message || err}`, 'bad');
    paint();
  }
}

async function onChange(e) {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const kind = el.dataset.change;
  try {
    switch (kind) {
      case 'import-file': {
        const file = el.files?.[0];
        if (!file) break;
        state.importStatus = `Đang đọc ${file.name}…`;
        paint();
        const XLSX = window.XLSX;
        if (!XLSX) throw new Error('Chưa tải thư viện đọc Excel (vendor/xlsx.full.min.js).');
        const ds = importWorkbook(XLSX, await file.arrayBuffer());
        state.importPreview = ds;
        state.importStatus = `Đã đọc ${file.name}. Kiểm tra bên dưới rồi xác nhận.`;
        paint();
        break;
      }

      case 'day':
        state.dayKey = el.value;
        paint();
        break;

      case 'pay-filter':
        state.pay[el.dataset.field] = el.value;
        state.pay.page = 0;
        paint();
        break;

      case 'pay': {
        const field = el.dataset.field;
        const value = field === 'lenaPlanDate' || field === 'actualDate' ? toDate(el.value) : toText(el.value) || null;
        await store.upsert('payments', { id: el.dataset.id, [field]: value });
        break;
      }

      case 'recon': {
        const field = el.dataset.field;
        const value = field === 'notes' ? toText(el.value) : toNum(el.value);
        await store.upsertRecon(el.dataset.date, { [field]: value });
        break;
      }

      case 'acct':
        await store.upsert('accounts', { id: el.dataset.id, balance: toNum(el.value) ?? 0 });
        break;

      case 'opex': {
        const item = state.ds.opex.find((x) => x.id === el.dataset.id);
        if (!item) break;
        const months = [...item.months];
        months[Number(el.dataset.idx)] = toNum(el.value) ?? 0;
        await store.upsert('opex', { id: item.id, months });
        break;
      }

      case 'cfmode':
        await store.patchSettings({ cfSourceLinks: el.value === 'source' });
        break;

      case 'cf-filter': {
        const field = el.dataset.field;
        const value = el.type === 'checkbox' ? el.checked : el.value;
        state.cf = { ...state.cf, [field]: value };
        paint();
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(err);
    setMessage(`Lỗi: ${err.message || err}`, 'bad');
    paint();
  }
}

async function onSubmit(e) {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const v = readForm(form);
  try {
    switch (kind) {
      case 'settings': {
        const s = state.ds.settings;
        const patch = {};
        for (const k of ['openingDate', 'planStart', 'dailyDetailsStart', 'forecastStart', 'planEnd', 'todayOverride']) patch[k] = v[k] ?? null;
        for (const k of ['minVnd', 'minUsd', 'tolVnd', 'tolUsd', 'cfRate']) patch[k] = v[k] ?? s[k];
        if (!patch.openingDate || !patch.planEnd) throw new Error('Ngày số dư đầu và ngày kết thúc là bắt buộc.');
        await store.patchSettings(patch);
        setMessage('Đã lưu cài đặt.', 'ok');
        paint();
        break;
      }

      case 'fxdef':
        await store.patchFxDefaults({ sell: v.sell ?? state.ds.fxDefaults.sell, buy: v.buy ?? state.ds.fxDefaults.buy });
        setMessage('Đã lưu tỷ giá mặc định.', 'ok');
        paint();
        break;

      case 'payment-add': {
        if (!v.item) throw new Error('Nhập mã khoản.');
        if (v.amount == null) throw new Error('Nhập số tiền.');
        await store.upsert('payments', {
          id: newId('m'),
          sourceRow: null,
          manual: true,
          item: v.item,
          type: v.type,
          payee: v.payee,
          description: v.description,
          amount: v.amount,
          currency: (v.currency || 'VND').toUpperCase(),
          reqDate: v.reqDate,
          dueDate: v.dueDate,
          lenaPlanDate: v.lenaPlanDate,
          actualDate: v.actualDate,
          actualRaw: v.actualRaw,
          category: v.category,
          project: v.project,
          dataIssue: null,
          issueResolved: false,
          akIssue: null,
          weekTyped: null,
          akFile: null,
          akFormula: null,
        });
        form.reset();
        setMessage('Đã thêm khoản chi.', 'ok');
        paint();
        break;
      }

      case 'crud-add': {
        const coll = form.dataset.coll;
        const prefix = { receipts: 'rc', fx: 'fx', bankAdj: 'ba' }[coll];
        if (!v.date) throw new Error('Nhập ngày.');
        if (v.amount == null && v.usd == null) throw new Error('Nhập số tiền.');
        const item = { id: newId(prefix), ...v };
        if (coll === 'fx') {
          if (v.usd == null || v.rate == null) throw new Error('Nhập USD và tỷ giá.');
          item.vnd = v.vnd ?? Math.round(v.usd * v.rate);
        }
        if (coll === 'receipts' || coll === 'bankAdj') item.currency = (v.currency || 'VND').toUpperCase();
        await store.upsert(coll, item);
        form.reset();
        setMessage('Đã thêm dòng.', 'ok');
        paint();
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(err);
    setMessage(`Lỗi: ${err.message || err}`, 'bad');
    paint();
  }
}

// ---------- boot ----------
async function boot() {
  const cloud = !!firebaseConfig?.apiKey && !String(firebaseConfig.apiKey).startsWith('REPLACE');
  try {
    store = cloud ? await createCloudStore(firebaseConfig) : createLocalStore();
  } catch (err) {
    console.error(err);
    if (cloud) {
      // Do not silently diverge into local-only data when shared mode fails.
      app.textContent = 'Không thể khởi tạo kết nối Firebase. Dữ liệu chưa được đồng bộ. Hãy kiểm tra cấu hình và tải lại trang.';
      return;
    }
    throw err;
  }

  store.onChange(onStore);
  if (store.auth) {
    store.auth.onChange((user) => {
      state.user = user ? { uid: user.uid } : null;
      if (user) store.connect();
      else store.disconnect();
      paint();
    });
  } else {
    store.connect();
  }
  onStore(store.get(), store.status);

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit);
  window.addEventListener('hashchange', () => {
    state.view = (location.hash || '').slice(1) || 'overview';
    paint();
  });
  if (!cloud) state.user = null;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker không đăng ký được', err));
  }
}

boot();
