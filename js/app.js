// Entry point: connects the store (local or Firebase), the engine and the screens.
import { runAll, todayKey } from '../src/engine.js';
import { buildQuality } from '../src/quality.js';
import { importWorkbook } from '../src/importer.js';
import { buildAiPackage } from '../src/ai-export.js';
import { createLocalStore, createCloudStore, withDefaults, LOCAL_KEY } from './store.js';
import { CASHFLOW_ACTUALS, CASHFLOW_OPENING, CASHFLOW_OPENING_STORED } from '../src/structure.js';
import { render, CF_FILTER_DEFAULT, categoryOptions } from './views.js';
import { validatePayment, validateCrud, replacedCounts, validatePlanRange } from '../src/validate.js';
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
  cal: { month: '', cur: 'VND' },
  ov: { mFrom: '', mTo: '' },
  dayKey: null,
  importPreview: null,
  importStatus: '',
  overwriteAck: false,
  overwritePhrase: '',
  recoveryImport: false,
  importSource: null,
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
  overview: 'Tổng quan', plan: 'Kế hoạch ngày', calendar: 'Lịch dòng tiền', details: 'Chi tiết ngày', payments: 'Thanh toán',
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

      case 'plan-auto-start':
        await store.patchSettings({ planStart: null });
        break;

      case 'cal-nav':
        state.cal = { ...state.cal, month: el.dataset.month };
        paint();
        break;

      case 'cal-day':
        state.dayKey = el.dataset.date;
        state.view = 'details';
        location.hash = 'details';
        setMessage('');
        paint();
        window.scrollTo(0, 0);
        break;

      case 'cf-reset':
        // resets the filters only; folded groups stay as they are
        state.cf = { ...CF_FILTER_DEFAULT, collapsed: state.cf.collapsed };
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

      case 'backup-dataset': {
        if (!state.ds) throw new Error('Chưa có dữ liệu để sao lưu.');
        if (!window.confirm('Sao lưu toàn bộ dữ liệu Cashflow vào máy? File JSON có thể chứa tên đối tác, số tài khoản, và thông tin nội bộ. Hãy lưu file an toàn, không đưa lên GitHub hoặc chia sẻ công khai.')) break;
        const payload = { ...state.ds, _backupFormat: 'svl.cashflow.backup.v1',
          _exportedAt: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'SVL_Cashflow_PRIVATE_Backup_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        setMessage('Đã xuất bản sao dữ liệu. File vẫn chỉ nằm trên thiết bị của bạn.', 'ok');
        paint();
        break;
      }

      case 'migration-retry': {
        if (state.status?.mode !== 'cloud' || state.status?.role !== 'admin' ||
            state.status?.sync !== 'server' || state.status?.migrationActive)
          throw new Error('Chưa đủ điều kiện để khôi phục lần nhập.');
        if (!window.confirm('Chỉ tiếp tục nếu lần nhập trước đã dừng và không còn tab nào đang nhập dữ liệu. Bạn đã xác nhận điều đó?')) break;
        state.recoveryImport = true;
        state.view = 'import';
        paint();
        break;
      }

      case 'legacy-preview': {
        if (state.status?.mode !== 'cloud' || state.status?.role !== 'admin'
            || state.status?.sync !== 'server'
            || (state.status?.state !== 'empty' && !state.recoveryImport)) {
          throw new Error('Chỉ Admin được chuyển dữ liệu khi Firestore chưa có dữ liệu.');
        }
        const raw = window.localStorage.getItem(LOCAL_KEY);
        if (!raw) throw new Error('Không tìm thấy Cashflow cũ trên trình duyệt này. Chọn bản sao lưu JSON hoặc file Excel gốc để nhập.');
        let existing;
        try { existing = JSON.parse(raw); }
        catch { throw new Error('Dữ liệu Cashflow cũ không phải JSON hợp lệ. Không thay đổi dữ liệu đã lưu.'); }
        if (!existing?.settings?.openingDate || !existing?.settings?.planEnd
          || !Array.isArray(existing.payments) || !Array.isArray(existing.receipts)
          || !Array.isArray(existing.accounts) || !Array.isArray(existing.fx)
          || !Array.isArray(existing.bankAdj) || !Array.isArray(existing.opex)) {
          throw new Error('Dữ liệu trình duyệt không đúng cấu trúc. Hãy dùng bản sao lưu JSON đầy đủ.');
        }
        const history = existing.cashflowActuals && Object.keys(existing.cashflowActuals).length
          ? existing.cashflowActuals : CASHFLOW_ACTUALS;
        const opening = existing.cashflowOpening ?? CASHFLOW_OPENING;
        if (!history || !Object.keys(history).length || opening == null)
          throw new Error('Thiếu dữ liệu Cashflow lịch sử. Hãy chọn bản sao lưu đầy đủ hoặc Excel gốc.');
        state.importPreview = withDefaults({
          ...existing,
          cashflowActuals: history,
          cashflowOpening: opening,
          cashflowOpeningStored: Object.keys(existing.cashflowOpeningStored || {}).length
            ? existing.cashflowOpeningStored : CASHFLOW_OPENING_STORED,
        });
        state.importSource = 'legacy-browser';
        state.importStatus = 'Đã tìm thấy dữ liệu trên trình duyệt này và bổ sung lịch sử Cashflow. Kiểm tra số lượng, sau đó xác nhận để sao lưu riêng và chuyển lên Firebase.';
        paint();
        break;
      }

      case 'import-confirm': {
        if (state.status?.mode === 'cloud' && state.status?.role !== 'admin')
          throw new Error('Chỉ Admin được thay thế dữ liệu chung.');
        if (!state.importPreview) throw new Error('Chưa chọn dữ liệu để nhập.');
        if (state.status?.mode === 'cloud' && !window.confirm('CẢNH BÁO: Bạn chuẩn bị nhập dữ liệu đã sao lưu vào Firestore dùng chung. Đây là lần nhập ban đầu vào database trống. Giữ bản sao lưu an toàn và không đóng tab cho đến khi hoàn tất. Tiếp tục?')) break;
        const next = state.importPreview;
        if (state.importSource === 'legacy-browser') {
          const backup = { ...next, _backupFormat: 'svl.cashflow.backup.v1',
            _exportedAt: new Date().toISOString() };
          const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'SVL_Cashflow_PRIVATE_FULL_' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(link); link.click(); link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 30000);
          if (!window.confirm('Đã yêu cầu tải bản sao lưu ĐẦY ĐỦ xuống máy. Hãy kiểm tra Downloads và bảo quản file riêng tư. Bạn xác nhận đã lưu được file và muốn nhập lên Firestore?')) break;
        }
        if (state.status?.mode !== 'cloud') {
          const prev = state.ds?.settings || {};
          next.settings = { ...next.settings, cfSourceLinks: !!prev.cfSourceLinks, todayOverride: prev.todayOverride ?? null };
        }
        await store.replaceAll(next);
        state.importPreview = null;
        state.importSource = null;
        state.importStatus = '';
        state.recoveryImport = false;
        setMessage('Đã xác nhận nhập dữ liệu vào Firestore. Đợi màn hình báo đã đồng bộ.', 'ok');
        state.view = 'overview';
        location.hash = 'overview';
        paint();
        break;
      }

      case 'overwrite-confirm': {
        if (state.status?.role !== 'admin') throw new Error('Chỉ Admin được ghi đè dữ liệu chung.');
        if (!state.importPreview) throw new Error('Chưa chọn dữ liệu để nhập.');
        if (!state.overwriteAck) throw new Error('Hãy xác nhận đã sao lưu dữ liệu hiện tại.');
        if (state.overwritePhrase !== 'GHI ĐÈ') throw new Error('Gõ đúng cụm từ GHI ĐÈ để xác nhận.');
        const n = Object.values(state.importPreview).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
        if (!window.confirm(`Ghi đè TOÀN BỘ dữ liệu Firestore dùng chung bằng ${n} bản ghi từ file này? Dữ liệu cũ không còn trong file sẽ bị xóa. Không hoàn tác được.`)) break;
        await store.replaceAll(state.importPreview, { overwrite: true });
        state.importPreview = null;
        state.importSource = null;
        state.importStatus = '';
        state.recoveryImport = false;
        state.overwriteAck = false;
        state.overwritePhrase = '';
        setMessage('Đã ghi đè dữ liệu Firestore. Đợi màn hình báo đã đồng bộ.', 'ok');
        state.view = 'overview';
        location.hash = 'overview';
        paint();
        break;
      }

      case 'import-cancel':
        state.overwriteAck = false;
        state.overwritePhrase = '';
        state.importSource = null;
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
        let ds;
        if (/\.json$/i.test(file.name)) {
          if (file.size > 25 * 1024 * 1024) throw new Error('File JSON vượt giới hạn 25 MB.');
          const data = JSON.parse(await file.text());
          if (!data || typeof data !== 'object' || !data.settings ||
              typeof data.settings.openingDate !== 'string' ||
              typeof data.settings.planEnd !== 'string' ||
              !Array.isArray(data.payments) || !Array.isArray(data.receipts) ||
              !Array.isArray(data.accounts) || !Array.isArray(data.fx) ||
              !Array.isArray(data.bankAdj) || !Array.isArray(data.opex)) {
            throw new Error('File JSON không đúng cấu trúc bản sao lưu SVL Cashflow.');
          }
          ds = withDefaults(data);
        } else {
          const XLSX = window.XLSX;
          if (!XLSX) throw new Error('Chưa tải thư viện đọc Excel (vendor/xlsx.full.min.js).');
          ds = importWorkbook(XLSX, await file.arrayBuffer());
        }
        state.importPreview = ds;
        state.importSource = 'uploaded-file';
        const historyCount = Object.keys(ds.cashflowActuals || {}).length;
        state.importStatus = historyCount && ds.cashflowOpening != null
          ? `Đã đọc ${file.name}; có ${historyCount} dòng lịch sử Cashflow. Kiểm tra trước khi nhập.`
          : 'Bản sao lưu chưa có lịch sử Cashflow. Hãy tải bản JSON đầy đủ mới từ trang sao lưu.';
        paint();
        break;
      }

      case 'day':
        state.dayKey = el.value;
        paint();
        break;

      case 'plan-range': {
        const field = el.dataset.field;
        const value = toDate(el.value);
        const st = state.ds.settings;
        const check = validatePlanRange(
          { planStart: st.planStart ?? null, planEnd: st.planEnd ?? null, [field]: value },
          { openingDate: st.openingDate }
        );
        if (check.error) throw new Error(check.error);
        await store.patchSettings({ [field]: value });
        break;
      }

      case 'pay-filter':
        state.pay[el.dataset.field] = el.value;
        state.pay.page = 0;
        paint();
        break;

      case 'pay': {
        const field = el.dataset.field;
        const value = field === 'lenaPlanDate' || field === 'actualDate' ? toDate(el.value) : toText(el.value) || null;
        if (field === 'category' && !value) throw new Error('Danh mục không được để trống: khoản sẽ không vào Cashflow.');
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

      case 'overwrite-ack':
        state.overwriteAck = el.checked;
        paint();
        break;

      case 'overwrite-phrase':
        state.overwritePhrase = el.value.trim();
        paint();
        break;

      case 'cfmode':
        await store.patchSettings({ cfSourceLinks: el.value === 'source' });
        break;

      case 'cal-cur':
        state.cal = { ...state.cal, cur: el.value };
        paint();
        break;

      case 'ov-filter': {
        state.ov = { ...state.ov, [el.dataset.field]: el.value };
        paint();
        break;
      }

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
        const check = validatePayment(v, {
          payments: state.ds.payments || [],
          categories: categoryOptions().map((c) => c.trim()),
        });
        if (check.error) throw new Error(check.error);
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
        const check = validateCrud(coll, v, state.ds);
        if (check.error) throw new Error(check.error);
        if (check.warnings.length && !confirm(`${check.warnings.join('\n')}\n\nVẫn thêm dòng này?`)) break;
        const item = { ...v, id: newId(prefix) };
        if (coll === 'fx') item.vnd = v.vnd ?? Math.round(v.usd * v.rate);
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
  const cloud = true; // Canonical Cashflow site; only Firestore is writable.
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
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-action]')) {
      e.preventDefault();
      e.target.click();
    }
  });
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit);
  window.addEventListener('hashchange', () => {
    state.view = (location.hash || '').slice(1) || 'overview';
    paint();
  });
  if (!cloud) state.user = null;

  // No service worker registered for isolated deployment.
}

boot();
