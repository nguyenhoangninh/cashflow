// Screens of the web app. Each function returns an HTML string from the calculated state (no DOM access),
// so the screens can be smoke-tested in Node. Events are wired in app.js via data-action / data-change.

import { CATEGORIES, suggestFx } from '../src/engine.js';
import { fmtInt, fmt2, fmtAmt, fmtDate, esc, negClass, isNum } from './format.js';

export const TABS = [
  ['overview', 'Tổng quan'],
  ['plan', 'Kế hoạch ngày'],
  ['details', 'Chi tiết ngày'],
  ['payments', 'Thanh toán'],
  ['receipts', 'Thu'],
  ['fx', 'Giao dịch FX'],
  ['bank', 'Điều chỉnh NH'],
  ['recon', 'Đối chiếu'],
  ['accounts', 'Số dư đầu'],
  ['weekly', 'Kế hoạch tuần'],
  ['cashflow', 'Dòng tiền'],
  ['opex', 'Opex'],
  ['quality', 'Kiểm tra dữ liệu'],
  ['import', 'Nhập file'],
];

const PAGE_SIZE = 150;
const PAY_INCLUDE = ['Yes', 'Paid', 'Review', 'Lỗi dữ liệu', 'No', '—'];
// Subtotal label of Cashflow row 35: items tagged with it would never reach the Cashflow.
const HIDDEN_CATEGORY = /^Others \(R&M/;
const categoryOptions = () => CATEGORIES.filter((c) => !HIDDEN_CATEGORY.test(String(c).trim()));

const sel = (value, options, attrs = '') => `<select ${attrs}>${options
  .map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(label)}</option>`)
  .join('')}</select>`;
const dateVal = (v) => (v ? esc(v) : '');
const numVal = (v) => (isNum(v) ? esc(v) : '');
const cell = (v, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${v}</td>`;
const hcell = (v, cls = '') => `<th${cls ? ` class="${cls}"` : ''}>${v}</th>`;
const money = (v, cur) => `<span class="num${negClass(v)}">${fmtAmt(v, cur)}</span>`;
const k2 = (v) => `<span class="num${negClass(v)}">${fmt2(v)}</span>`;

const sumOf = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const minBy = (arr, key) => arr.reduce((best, x) => (best == null || x[key] < best[key] ? x : best), null);

// Whole screen = tabs + status line + current view
export function render(view, s) {
  const body = s.status?.mode === 'cloud' && !s.user
    ? viewLogin(s)
    : !s.ds
      ? viewImport(s)
      : ({
      overview: overview,
      plan: plan,
      details: details,
      payments: payments,
      receipts: receipts,
      fx: fx,
      bank: bank,
      recon: recon,
      accounts: accounts,
      weekly: weekly,
      cashflow: cashflow,
      opex: opex,
      quality: quality,
      import: viewImport,
    }[view] || overview)(s);
  return `${header(s)}<section class="screen">${body}</section>`;
}

function header(s) {
  const tabs = TABS.map(([id, label]) =>
    `<button class="tab${s.view === id ? ' active' : ''}" data-action="nav" data-view="${id}">${esc(label)}</button>`).join('');
  const st = s.status || {};
  const badge = st.mode === 'cloud'
    ? (s.user ? `<span class="pill ok">Đã đăng nhập</span> <button data-action="logout">Đăng xuất</button>`
      : `<button class="primary" data-action="login">Đăng nhập Google</button>`)
    : `<span class="pill">Lưu trên trình duyệt</span>`;
  const msg = s.message ? `<div class="notice ${esc(s.messageKind || '')}">${esc(s.message)}</div>` : '';
  const err = st.state === 'error' ? `<div class="notice bad">${esc(st.message)}</div>` : '';
  return `<header class="topbar">
    <div class="brand">SVL · Dự báo dòng tiền</div>
    <nav class="tabs">${tabs}</nav>
    <div class="auth">${badge}</div>
  </header>${msg}${err}`;
}

// ---------- sign-in (cloud mode) ----------
function viewLogin(s) {
  const msg = s.status?.state === 'error' ? `<div class="notice bad">${esc(s.status.message)}</div>` : '';
  return `<div class="card narrow">
    <h2>Đăng nhập để xem dữ liệu</h2>
    <p>Dữ liệu dự báo dòng tiền được dùng chung. Chỉ các tài khoản Google đã được cấp quyền mới xem và sửa được.</p>
    <button class="primary" data-action="login">Đăng nhập bằng Google</button>
    ${msg}
  </div>`;
}

// ---------- empty / import ----------
function viewImport(s) {
  const p = s.importPreview;
  const cloud = s.status?.mode === 'cloud';
  const preview = p ? `<div class="card">
      <h3>Xem trước dữ liệu từ file</h3>
      <ul class="plain">
        <li>Khoản chi (Payment Request List): <b>${fmtInt(p.payments.length)}</b></li>
        <li>Khoản thu: <b>${fmtInt(p.receipts.length)}</b> · Giao dịch FX: <b>${fmtInt(p.fx.length)}</b> · Điều chỉnh NH: <b>${fmtInt(p.bankAdj.length)}</b></li>
        <li>Dòng đối chiếu: <b>${fmtInt(Object.keys(p.recon).length)}</b> · Dòng Opex: <b>${fmtInt(p.opex.length)}</b></li>
        <li>Ngày bắt đầu kế hoạch: ${fmtDate(p.settings.planStart) || 'tự động'} · Kết thúc: ${fmtDate(p.settings.planEnd)}</li>
      </ul>
      <p class="warn">${cloud ? 'Dữ liệu chung trên đám mây sẽ bị thay thế.' : 'Dữ liệu trên trình duyệt này sẽ bị thay thế.'}
        Các thay đổi đã nhập tay (kể cả “đã xử lý lỗi”) sẽ mất.</p>
      <button class="primary" data-action="import-confirm">Thay thế bằng dữ liệu này</button>
      <button data-action="import-cancel">Hủy</button>
    </div>` : '';
  return `<div class="card">
      <h2>Nhập dữ liệu từ file Excel</h2>
      <p>Chọn file <code>SVL_Payment_Ver6_Final_Ver_2.xlsm</code> (hoặc file cùng cấu trúc). Ứng dụng đọc các sheet
        Overview, Opening Balances, Payment Request List, Receipts, FX Transactions, Bank Adjustments,
        Reconciliation và Opex Control. Số tài khoản người nhận (cột W) không được nhập.</p>
      <input type="file" id="import-file" accept=".xlsm,.xlsx" data-change="import-file">
      <div class="status" id="import-status">${esc(s.importStatus || '')}</div>
    </div>${preview}`;
}

// ---------- Overview ----------
function overview(s) {
  const { calc } = s;
  const c = calc.ctx;
  const ov = calc.plan.overview;
  const days = calc.plan.days;
  const lowV = minBy(days, 'closeVnd');
  const lowU = minBy(days, 'closeUsd');
  const shortAll = days.filter((d) => d.alert !== 'OK').length;
  const shortExcel = days.slice(0, 48).filter((d) => d.alert !== 'OK').length;
  const pays = c.payments;
  const cnt = (inc) => pays.filter((p) => p.include === inc);
  const yes = cnt('Yes');
  const paid = cnt('Paid');
  const review = cnt('Review');
  const errs = cnt('Lỗi dữ liệu');
  const rc = s.ds.receipts || [];
  const incl = [...yes, ...paid];
  const sum = (list, cur) => sumOf(list.filter((p) => p.currency === cur), (p) => p.amount);
  const rcSum = (cur) => sumOf(rc.filter((r) => (r.currency || '').toUpperCase() === cur), (r) => r.amount);

  const card = (label, value, sub = '', cls = '') =>
    `<div class="kpi ${cls}"><div class="kl">${esc(label)}</div><div class="kv">${value}</div><div class="ks">${sub}</div></div>`;

  const error = calc.plan.error ? `<div class="notice bad">${esc(calc.plan.error)} (${esc(calc.plan.status)})</div>` : '';
  const empty = !pays.length ? `<div class="notice">Chưa có dữ liệu thanh toán.</div>` : '';
  return `${error}${empty}
  <div class="status-line">
    Chế độ bắt đầu: <b>${esc(c.startMode)}</b> · Bắt đầu kế hoạch <b>${fmtDate(c.start)}</b>
    · Dự báo từ <b>${fmtDate(c.forecastStart)}</b> · Chi tiết từ <b>${fmtDate(c.ddStart)}</b>
    · Kết thúc <b>${fmtDate(c.scopeEnd)}</b> · Ngày tính <b>${fmtDate(c.today)}</b>
  </div>
  <div class="kpis">
    ${card('Số dư đầu VND (tài khoản)', `<span class="num">${fmtInt(c.openVnd)}</span>`)}
    ${card('Số dư đầu USD (tài khoản)', `<span class="num">${fmt2(c.openUsd)}</span>`)}
    ${card('Tổng quy đổi VND', `<span class="num">${fmtInt(ov.totalLiquidityVnd)}</span>`, `tỷ giá ${fmtInt(ov.firstSellRate)}`)}
    ${card('Thấp nhất VND', `<span class="num${negClass(lowV?.closeVnd)}">${fmtInt(lowV?.closeVnd)}</span>`, lowV ? fmtDate(lowV.date) : '', lowV && lowV.closeVnd < c.minVnd ? 'bad' : '')}
    ${card('Thấp nhất USD', `<span class="num${negClass(lowU?.closeUsd)}">${fmt2(lowU?.closeUsd)}</span>`, lowU ? fmtDate(lowU.date) : '', lowU && lowU.closeUsd < c.minUsd ? 'bad' : '')}
    ${card('Ngày dưới ngưỡng', `${fmtInt(shortAll)} / ${fmtInt(days.length)}`, `trong 48 dòng đầu (kiểu file gốc): ${fmtInt(shortExcel)}`, shortAll ? 'bad' : '')}
  </div>
  <div class="kpis">
    ${card('Chi đưa vào kế hoạch (VND)', `<span class="num">${fmtInt(sum(incl, 'VND'))}</span>`, `${fmtInt(incl.length)} khoản`)}
    ${card('Chi đưa vào kế hoạch (USD)', `<span class="num">${fmt2(sum(incl, 'USD'))}</span>`, `${fmtInt(incl.filter((p) => p.currency === 'USD').length)} khoản USD`)}
    ${card('Chờ xem xét (Review)', `${fmtInt(review.length)} khoản`, `VND ${fmtInt(sum(review, 'VND'))} · USD ${fmt2(sum(review, 'USD'))}`, review.length ? 'warn' : '')}
    ${card('Lỗi dữ liệu nguồn', `${fmtInt(errs.length)} khoản`, errs.length ? 'Không vào kế hoạch cho tới khi “đã xử lý”' : 'không có', errs.length ? 'bad' : '')}
    ${card('Thu dự kiến VND', `<span class="num">${fmtInt(rcSum('VND'))}</span>`, 'từ sheet Receipts')}
    ${card('Thu dự kiến USD', `<span class="num">${fmt2(rcSum('USD'))}</span>`, 'từ sheet Receipts')}
  </div>
  <div class="card">
    <h3>Cài đặt ngày và ngưỡng</h3>
    <p class="muted">Để trống ngày bắt đầu/chi tiết/dự báo để dùng giá trị tự động như file gốc.</p>
    <form data-form="settings" class="grid-form">
      ${dateField('openingDate', 'Ngày số dư đầu (Overview F13)', s.ds.settings.openingDate)}
      ${dateField('planStart', 'Ngày bắt đầu kế hoạch (C12)', s.ds.settings.planStart)}
      ${dateField('dailyDetailsStart', 'Chi tiết từ ngày (F15)', s.ds.settings.dailyDetailsStart)}
      ${dateField('forecastStart', 'Dự báo từ ngày (F17)', s.ds.settings.forecastStart)}
      ${dateField('planEnd', 'Kết thúc kế hoạch (C13)', s.ds.settings.planEnd)}
      ${dateField('todayOverride', 'Ngày tính (để trống = hôm nay)', s.ds.settings.todayOverride)}
      ${numField('minVnd', 'Số dư tối thiểu VND (C9)', s.ds.settings.minVnd)}
      ${numField('minUsd', 'Số dư tối thiểu USD (C10)', s.ds.settings.minUsd)}
      ${numField('tolVnd', 'Dung sai đối chiếu VND', s.ds.settings.tolVnd)}
      ${numField('tolUsd', 'Dung sai đối chiếu USD', s.ds.settings.tolUsd)}
      ${numField('cfRate', 'Tỷ giá quy USD trong Cashflow (Opex!B2)', s.ds.settings.cfRate)}
      <div class="form-actions"><button class="primary" type="submit">Lưu cài đặt</button></div>
    </form>
  </div>`;
}

const dateField = (name, label, value) =>
  `<label>${esc(label)}<input type="date" name="${name}" data-type="date" value="${dateVal(value)}"></label>`;
const numField = (name, label, value) =>
  `<label>${esc(label)}<input type="number" step="any" name="${name}" data-type="number" value="${numVal(value)}"></label>`;

// ---------- Daily Plan ----------
function plan(s) {
  const p = s.calc.plan;
  const c = s.calc.ctx;
  const rows = p.days.map((d) => {
    const sug = suggestFx(d);
    const sugHtml = [
      sug.sellUsd ? `<button data-action="fx-suggest" data-date="${d.date}" data-kind="SELL USD" data-usd="${sug.sellUsd}" data-rate="${d.sellRate}">Bán ${fmtInt(sug.sellUsd)} USD</button>` : '',
      sug.buyUsd ? `<button data-action="fx-suggest" data-date="${d.date}" data-kind="BUY USD" data-usd="${sug.buyUsd}" data-rate="${d.buyRate}">Mua ${fmtInt(sug.buyUsd)} USD</button>` : '',
    ].join(' ');
    const bad = d.alert !== 'OK';
    return `<tr class="${bad ? 'bad-row' : ''}">
      ${cell(fmtDate(d.date))}${cell(esc(d.day), 'muted')}
      ${cell(money(d.openVnd, 'VND'))}${cell(money(d.inVnd, 'VND'))}${cell(money(d.outVnd, 'VND'))}
      ${cell(money(d.sellUsd, 'USD'))}${cell(money(d.buyUsd, 'USD'))}${cell(fmtInt(d.sellRate))}
      ${cell(money(d.closeVnd, 'VND'))}
      ${cell(money(d.openUsd, 'USD'))}${cell(money(d.inUsd, 'USD'))}${cell(money(d.outUsd, 'USD'))}
      ${cell(money(d.closeUsd, 'USD'))}${cell(money(d.totalUsd, 'USD'))}
      ${cell(bad ? `<span class="pill bad">${esc(d.alert)}</span>` : '<span class="pill ok">OK</span>')}
      ${cell(sugHtml)}
    </tr>`;
  }).join('');
  const err = p.error ? `<div class="notice bad">${esc(p.error)}</div>` : '';
  return `${err}<div class="status-line">Từ <b>${fmtDate(c.start)}</b> đến <b>${fmtDate(p.end)}</b> · ${esc(p.status)} · Ngưỡng VND ${fmtInt(c.minVnd)}, USD ${fmt2(c.minUsd)}</div>
  <div class="table-wrap sticky">
  <table class="dense">
    <thead><tr>
      ${['Ngày', 'Thứ', 'Đầu VND', 'Thu VND', 'Chi VND', 'Bán USD', 'Mua USD', 'Tỷ giá bán', 'Cuối VND', 'Đầu USD', 'Thu USD', 'Chi USD', 'Cuối USD', 'Quy đổi USD', 'Cảnh báo', 'Gợi ý FX']
        .map((h) => hcell(h)).join('')}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ---------- Daily Details ----------
function details(s) {
  const days = s.calc.details;
  if (!days.length) return `<div class="notice">Không có ngày nào trong phạm vi chi tiết.</div>`;
  const key = days.some((d) => d.date === s.dayKey) ? s.dayKey : days[0].date;
  const d = days.find((x) => x.date === key);
  const options = days.map((x) => [x.date, fmtDate(x.date)]);
  const items = d.items.map((it) => `<tr>
    ${cell(esc(it.item))}${cell(esc(it.type || ''), 'muted')}${cell(esc(it.payee || ''))}${cell(esc(it.description || ''))}
    ${cell(esc(it.category || ''), 'muted')}${cell(esc(it.project || ''), 'muted')}
    ${cell(money(Number(it.amount), it.currency))}${cell(esc(it.currency))}
  </tr>`).join('');
  return `<div class="toolbar"><label>Ngày ${sel(key, options, 'data-change="day" name="day"')}</label></div>
  <div class="kpis">
    <div class="kpi"><div class="kl">Đầu ngày VND</div><div class="kv num">${fmtInt(d.openVnd)}</div></div>
    <div class="kpi"><div class="kl">Chi trong ngày VND</div><div class="kv num">${fmtInt(d.totalVnd)}</div></div>
    <div class="kpi"><div class="kl">Cuối ngày VND</div><div class="kv num${negClass(d.closeVnd)}">${fmtInt(d.closeVnd)}</div></div>
    <div class="kpi"><div class="kl">Đầu ngày USD</div><div class="kv num">${fmt2(d.openUsd)}</div></div>
    <div class="kpi"><div class="kl">Chi trong ngày USD</div><div class="kv num">${fmt2(d.totalUsd)}</div></div>
    <div class="kpi"><div class="kl">Cuối ngày USD</div><div class="kv num${negClass(d.closeUsd)}">${fmt2(d.closeUsd)}</div></div>
  </div>
  <div class="table-wrap"><table class="dense">
    <thead><tr>${['Mã', 'Loại', 'Người nhận', 'Nội dung', 'Danh mục', 'Dự án', 'Số tiền', 'TT'].map((h) => hcell(h)).join('')}</tr></thead>
    <tbody>${items || `<tr><td colspan="8" class="muted">Không có khoản nào</td></tr>`}</tbody>
  </table></div>`;
}

// ---------- Payment Request List ----------
function filterPayments(all, f) {
  const q = (f.q || '').trim().toLowerCase();
  return all.filter((p) => {
    if (f.include && p.include !== f.include) return false;
    if (f.cur && p.currency !== f.cur) return false;
    if (f.cat && (p.category || '').trim() !== f.cat) return false;
    if (q) {
      const hay = `${p.item} ${p.payee || ''} ${p.description || ''} ${p.type || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function payments(s) {
  const f = s.pay || {};
  const all = s.calc.ctx.payments;
  const list = filterPayments(all, f);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(f.page || 0, pages - 1);
  const slice = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const catOpts = [['', 'Tất cả danh mục'], ...categoryOptions().map((c) => [c.trim(), c.trim()])];
  const inc = [['', 'Tất cả trạng thái'], ...PAY_INCLUDE.map((x) => [x, x])];

  const rows = slice.map((p) => {
    const cats = categoryOptions().map((c) => [c.trim(), c.trim()]);
    const catSelect = sel(p.category ? p.category.trim() : '', [['', '— chọn —'], ...cats],
      `data-change="pay" data-id="${esc(p.id)}" data-field="category"`);
    const resolve = p.dataIssue
      ? `<button data-action="pay-resolve" data-id="${esc(p.id)}">${p.issueResolved ? 'Đã xử lý ✓' : 'Đánh dấu đã xử lý'}</button>`
      : (p.akIssue ? '<span class="pill warn">USD’K</span>' : '');
    const incCls = p.include === 'Yes' || p.include === 'Paid' ? 'ok' : (p.include === 'Lỗi dữ liệu' ? 'bad' : (p.include === 'Review' ? 'warn' : ''));
    return `<tr class="${p.dataIssue && !p.issueResolved ? 'bad-row' : ''}">
      ${cell(esc(p.item))}${cell(esc(p.type || ''), 'muted')}${cell(esc(p.payee || ''))}
      ${cell(esc((p.description || '').slice(0, 80)), 'muted')}
      ${cell(money(Number(p.amount), p.currency))}${cell(esc(p.currency || ''))}
      ${cell(fmtDate(p.reqDate))}${cell(fmtDate(p.dueDate))}
      ${cell(`<input type="date" value="${dateVal(p.lenaPlanDate)}" data-change="pay" data-id="${esc(p.id)}" data-field="lenaPlanDate">`)}
      ${cell(`<input type="date" value="${dateVal(p.actualDate)}" data-change="pay" data-id="${esc(p.id)}" data-field="actualDate">`)}
      ${cell(fmtDate(p.est))}
      ${cell(`<span class="pill ${incCls}">${esc(p.include)}</span>`)}
      ${cell(fmtDate(p.planDate))}${cell(esc(p.weekPlan || ''))}
      ${cell(catSelect)}
      ${cell(`<input type="text" value="${esc(p.project || '')}" data-change="pay" data-id="${esc(p.id)}" data-field="project">`)}
      ${cell(k2(p.amountUsdK))}
      ${cell(`<input type="text" value="${esc(p.actualRaw || '')}" data-change="pay" data-id="${esc(p.id)}" data-field="actualRaw" placeholder="Cờ (Old, Cancel, …)">`)}
      ${cell(resolve)}
    </tr>`;
  }).join('');

  return `<div class="toolbar">
      <input type="search" placeholder="Tìm mã, người nhận, nội dung" value="${esc(f.q || '')}" data-change="pay-filter" data-field="q">
      ${sel(f.include || '', inc, 'data-change="pay-filter" data-field="include"')}
      ${sel(f.cur || '', [['', 'Mọi tiền tệ'], ['VND', 'VND'], ['USD', 'USD']], 'data-change="pay-filter" data-field="cur"')}
      ${sel(f.cat || '', catOpts, 'data-change="pay-filter" data-field="cat"')}
      <span class="muted">${fmtInt(list.length)} / ${fmtInt(all.length)} khoản</span>
      <button data-action="pay-page" data-dir="-1" ${page <= 0 ? 'disabled' : ''}>◀</button>
      <span>Trang ${page + 1}/${pages}</span>
      <button data-action="pay-page" data-dir="1" ${page >= pages - 1 ? 'disabled' : ''}>▶</button>
  </div>
  <div class="table-wrap sticky"><table class="dense wide">
    <thead><tr>${['Mã', 'Loại', 'Người nhận', 'Nội dung', 'Số tiền', 'TT', 'Ngày yêu cầu', 'Hạn', 'Ngày Lena (X)', 'Ngày chi thực tế (S)', 'Ngày dự kiến (Z)', 'Include (AB)', 'Ngày KH (AD)', 'Tuần', 'Danh mục (AJ)', 'Dự án (AL)', "USD'K (AK)", 'Cờ (N/Flag)', 'Lỗi nguồn']
      .map((h) => hcell(h)).join('')}</tr></thead>
    <tbody>${rows || `<tr><td colspan="19" class="muted">Không có khoản nào khớp bộ lọc</td></tr>`}</tbody>
  </table></div>
  <details class="card"><summary>Thêm khoản chi mới</summary>
    <form data-form="payment-add" class="grid-form">
      ${textField('item', 'Mã')}${textField('type', 'Loại yêu cầu')}${textField('payee', 'Người nhận')}
      ${textField('description', 'Nội dung')}${numField2('amount', 'Số tiền')}
      ${sel('VND', [['VND', 'VND'], ['USD', 'USD']], 'name="currency"')}
      ${dateField('reqDate', 'Ngày yêu cầu', null)}${dateField('dueDate', 'Hạn thanh toán', null)}
      ${dateField('lenaPlanDate', 'Ngày Lena dự kiến', null)}${dateField('actualDate', 'Ngày chi thực tế', null)}
      ${sel('', [['', '— danh mục —'], ...categoryOptions().map((c) => [c.trim(), c.trim()])], 'name="category"')}
      ${textField('project', 'Dự án')}${textField('actualRaw', 'Cờ (Old/Cancel/…)')}
      <div class="form-actions"><button class="primary" type="submit">Thêm khoản</button></div>
    </form>
  </details>`;
}
const textField = (name, label) => `<label>${esc(label)}<input type="text" name="${name}"></label>`;
const numField2 = (name, label) => `<label>${esc(label)}<input type="number" step="any" name="${name}" data-type="number"></label>`;

// ---------- simple lists: receipts / FX / bank adjustments ----------
const CRUD = {
  receipts: {
    title: 'Khoản thu (Receipts)',
    cols: [['date', 'Ngày', 'date'], ['description', 'Nội dung'], ['source', 'Nguồn'], ['currency', 'TT'],
      ['amount', 'Số tiền', 'num'], ['category', 'Danh mục'], ['notes', 'Ghi chú']],
    form: [['date', 'Ngày', 'date'], ['description', 'Nội dung', 'text'], ['source', 'Nguồn', 'text'],
      ['currency', 'Tiền tệ', 'cur'], ['amount', 'Số tiền', 'number'], ['category', 'Danh mục', 'text'], ['notes', 'Ghi chú', 'text']],
    sort: (x) => x.date,
    prefix: 'rc',
  },
  fx: {
    title: 'Giao dịch FX',
    cols: [['date', 'Ngày', 'date'], ['type', 'Loại'], ['usd', 'USD', 'usd'], ['rate', 'Tỷ giá', 'num'],
      ['vnd', 'VND', 'num'], ['bank', 'Ngân hàng'], ['ref', 'Tham chiếu'], ['notes', 'Ghi chú']],
    form: [['date', 'Ngày', 'date'], ['type', 'Loại', 'fxtype'], ['usd', 'USD', 'number'], ['rate', 'Tỷ giá', 'number'],
      ['vnd', 'VND (bỏ trống = USD × tỷ giá)', 'number'], ['bank', 'Ngân hàng', 'text'], ['ref', 'Tham chiếu', 'text'], ['notes', 'Ghi chú', 'text']],
    sort: (x) => x.date,
    prefix: 'fx',
  },
  bankAdj: {
    title: 'Điều chỉnh ngân hàng (Bank Adjustments)',
    cols: [['date', 'Ngày', 'date'], ['bank', 'Ngân hàng'], ['account', 'Tài khoản'], ['currency', 'TT'],
      ['direction', 'Chiều'], ['amount', 'Số tiền', 'num'], ['type', 'Loại'], ['notes', 'Ghi chú']],
    form: [['date', 'Ngày', 'date'], ['bank', 'Ngân hàng', 'text'], ['account', 'Tài khoản', 'text'], ['currency', 'Tiền tệ', 'cur'],
      ['direction', 'Chiều', 'dir'], ['amount', 'Số tiền', 'number'], ['type', 'Loại', 'text'], ['notes', 'Ghi chú', 'text']],
    sort: (x) => x.date,
    prefix: 'ba',
  },
};

function crudView(s, coll) {
  const cfg = CRUD[coll];
  const rows = [...(s.ds[coll] || [])].sort((a, b) => String(cfg.sort(a)).localeCompare(String(cfg.sort(b))));
  const head = cfg.cols.map(([, label]) => hcell(esc(label))).join('') + hcell('');
  const body = rows.map((r) => `<tr>${cfg.cols.map(([k, , t]) => {
    const v = r[k];
    if (t === 'date') return cell(fmtDate(v));
    if (t === 'num') return cell(v == null || v === '' ? '' : `<span class="num">${fmt2(Number(v))}</span>`);
    if (t === 'usd') return cell(`<span class="num">${fmt2(Number(v))}</span>`);
    return cell(esc(v ?? ''));
  }).join('')}${cell(`<button data-action="crud-del" data-coll="${coll}" data-id="${esc(r.id)}">Xóa</button>`)}</tr>`).join('');
  const totals = coll === 'receipts' ? `Tổng VND ${fmtInt(sumOf(rows.filter((r) => r.currency === 'VND'), (r) => r.amount))} · Tổng USD ${fmt2(sumOf(rows.filter((r) => r.currency === 'USD'), (r) => r.amount))}` : `${fmtInt(rows.length)} dòng`;
  const form = cfg.form.map(([name, label, t]) => {
    if (t === 'date') return dateField(name, label, null);
    if (t === 'number') return numField2(name, label);
    if (t === 'text') return textField(name, label);
    if (t === 'cur') return `<label>${esc(label)}${sel('VND', [['VND', 'VND'], ['USD', 'USD']], `name="${name}"`)}</label>`;
    if (t === 'dir') return `<label>${esc(label)}${sel('IN', [['IN', 'IN (vào)'], ['OUT', 'OUT (ra)']], `name="${name}"`)}</label>`;
    if (t === 'fxtype') return `<label>${esc(label)}${sel('SELL USD', [['SELL USD', 'SELL USD (bán USD)'], ['BUY USD', 'BUY USD (mua USD)']], `name="${name}"`)}</label>`;
    return '';
  }).join('');
  return `<div class="status-line">${cfg.title} · ${totals}</div>
  <div class="table-wrap"><table class="dense"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cfg.cols.length + 1}" class="muted">Chưa có dòng nào</td></tr>`}</tbody></table></div>
  <details class="card" open><summary>Thêm dòng</summary>
    <form data-form="crud-add" data-coll="${coll}" class="grid-form">${form}
      <div class="form-actions"><button class="primary" type="submit">Thêm</button></div>
    </form>
  </details>`;
}
const receipts = (s) => crudView(s, 'receipts');
const fx = (s) => crudView(s, 'fx');
const bank = (s) => crudView(s, 'bankAdj');

// ---------- Reconciliation ----------
function recon(s) {
  const end = s.calc.ctx.scopeEnd;
  const rows = s.calc.recon.filter((r) => r.date <= end || (s.ds.recon?.[r.date] && Object.values(s.ds.recon[r.date]).some((v) => v !== null && v !== '' && v !== undefined)));
  const body = rows.map((r) => {
    const raw = s.ds.recon?.[r.date] || {};
    const inp = (field, width = 'w-num') =>
      `<td><input class="${width}" type="number" step="any" value="${numVal(raw[field])}" data-change="recon" data-date="${r.date}" data-field="${field}"></td>`;
    return `<tr class="${r.status && r.status !== 'OK' ? 'bad-row' : ''}">
      ${cell(fmtDate(r.date))}
      ${inp('uobVnd')}${inp('uobUsd1')}${inp('uobUsd2')}${inp('vtVnd')}${inp('vtUsd')}
      <td><input class="w-note" type="text" value="${esc(raw.notes || '')}" data-change="recon" data-date="${r.date}" data-field="notes"></td>
      ${cell(money(r.actVnd, 'VND'))}${cell(money(r.planVnd, 'VND'))}${cell(money(r.diffVnd, 'VND'))}
      ${cell(money(r.actUsd, 'USD'))}${cell(money(r.planUsd, 'USD'))}${cell(money(r.diffUsd, 'USD'))}
      ${cell(r.status ? `<span class="pill ${r.status === 'OK' ? 'ok' : 'bad'}">${esc(r.status)}</span>` : '')}
    </tr>`;
  }).join('');
  return `<div class="status-line">Số dư thực tế nhập từ sao kê. Dung sai: VND ${fmtInt(s.calc.ctx.tolVnd)}, USD ${fmt2(s.calc.ctx.tolUsd)}. Dòng trước ngày bắt đầu lấy số thực tế làm kế hoạch.</div>
  <div class="table-wrap sticky"><table class="dense wide">
    <thead><tr>${['Ngày', 'UOB VND', 'UOB USD (CA)', 'UOB USD (Inv.)', 'VietinBank VND', 'VietinBank USD', 'Ghi chú',
      'Thực tế VND', 'Kế hoạch VND', 'Lệch VND', 'Thực tế USD', 'Kế hoạch USD', 'Lệch USD', 'Trạng thái']
      .map((h) => hcell(h)).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

// ---------- Accounts and FX defaults ----------
function accounts(s) {
  const rows = s.ds.accounts.map((a) => `<tr>
    ${cell(esc(a.bank))}${cell(esc(a.name))}${cell(esc(a.account))}${cell(esc(a.currency))}
    ${cell(`<input class="w-num" type="number" step="any" value="${numVal(a.balance)}" data-change="acct" data-id="${esc(a.id)}">`)}
  </tr>`).join('');
  return `<div class="card"><h3>Số dư đầu kỳ theo tài khoản</h3>
    <div class="table-wrap"><table class="dense"><thead><tr>${['Ngân hàng', 'Loại tài khoản', 'Số tài khoản', 'TT', 'Số dư đầu']
      .map((h) => hcell(h)).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
  </div>
  <div class="card"><h3>Tỷ giá mặc định (sheet FX)</h3>
    <form data-form="fxdef" class="grid-form">
      <label>Bán USD (FX!B3)<input type="number" step="any" name="sell" data-type="number" value="${numVal(s.ds.fxDefaults.sell)}"></label>
      <label>Mua USD (FX!E3)<input type="number" step="any" name="buy" data-type="number" value="${numVal(s.ds.fxDefaults.buy)}"></label>
      <div class="form-actions"><button class="primary" type="submit">Lưu tỷ giá</button></div>
    </form>
  </div>`;
}

// ---------- Weekly ----------
function weekly(s) {
  const weeks = s.calc.cashflow.weeks;
  const rows = s.calc.weekly.map((w, i) => {
    const actual = weeks[i]?.actual;
    return `<tr class="${actual ? 'actual' : ''}">
      ${cell(esc(w.code))}${cell(`${fmtDate(w.from)} – ${fmtDate(w.to)}`, 'muted')}
      ${cell(money(w.inVnd, 'VND'))}${cell(money(w.outVnd, 'VND'))}
      ${cell(money(w.sellUsd, 'USD'))}${cell(money(w.buyUsd, 'USD'))}
      ${cell(money(w.netFx, 'VND'))}
      ${cell(money(w.inUsd, 'USD'))}${cell(money(w.outUsd, 'USD'))}
      ${cell(w.endVnd === '' ? '' : money(w.endVnd, 'VND'))}${cell(w.endUsd === '' ? '' : money(w.endUsd, 'USD'))}
      ${cell(w.alert ? `<span class="pill ${w.alert === 'OK' ? 'ok' : 'bad'}">${esc(w.alert)}</span>` : '')}
    </tr>`;
  }).join('');
  return `<div class="status-line">Dòng xám nền xanh là tuần thực tế (đã nhập theo sao kê). Số dư cuối tính cả điều chỉnh ngân hàng.</div>
  <div class="table-wrap sticky"><table class="dense wide">
    <thead><tr>${['Tuần', 'Thời gian', 'Thu VND', 'Chi VND', 'Bán USD', 'Mua USD', 'Lệch FX VND', 'Thu USD', 'Chi USD', 'Cuối VND', 'Cuối USD', 'Cảnh báo']
      .map((h) => hcell(h)).join('')}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ---------- Cashflow (USD'000K) ----------
function cashflow(s) {
  const cf = s.calc.cashflow;
  const mode = s.ds.settings.cfSourceLinks ? 'source' : 'chain';
  const head = cf.weeks.map((w) => `<th class="${w.actual ? 'actual' : ''}">${esc(w.code)}<div class="sub">${w.actual ? 'TT' : 'DB'}</div></th>`).join('');
  const body = cf.rows.map((r) => {
    if (r.type === 'header') {
      return `<tr class="section"><td class="sticky-col">${esc(r.label.trim())}</td><td colspan="${cf.weeks.length}"></td></tr>`;
    }
    const strong = ['sum_receipt', 'sum_opex', 'sum_capex', 'net', 'ending', 'opening'].includes(r.type);
    return `<tr class="${strong ? 'strong' : ''}">
      <td class="sticky-col">${esc(r.label.trim())}</td>
      ${r.values.map((v, i) => `<td class="${cf.weeks[i].actual ? 'actual' : ''}">${k2(v)}</td>`).join('')}
    </tr>`;
  }).join('');
  return `<div class="toolbar">
    <span>Liên kết số dư đầu kỳ 11.1–12.4:</span>
    <label class="radio"><input type="radio" name="cfmode" value="chain" data-change="cfmode" ${mode === 'chain' ? 'checked' : ''}> Chuỗi đúng (cuối tuần trước)</label>
    <label class="radio"><input type="radio" name="cfmode" value="source" data-change="cfmode" ${mode === 'source' ? 'checked' : ''}> Như file gốc (V8:AC8)</label>
  </div>
  <div class="status-line">Đơn vị USD'000K. Tuần thực tế (TT) lấy số đã nhập; tuần dự báo (DB) tính từ danh sách thanh toán và thu.</div>
  <div class="table-wrap sticky"><table class="dense cf">
    <thead><tr><th class="sticky-col">Mục</th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

// ---------- Opex ----------
function opex(s) {
  const o = s.calc.opex;
  const body = o.sections.map((sec) => {
    const items = sec.items.map((it) => `<tr>
      ${cell(esc(it.no || ''), 'muted')}${cell(esc(it.name || ''))}${cell(esc(it.terms || ''), 'muted')}
      ${it.months.map((v, i) => `<td><input class="w-num" type="number" step="any" value="${numVal(v)}" data-change="opex" data-id="${esc(it.id)}" data-idx="${i}"></td>`).join('')}
      ${cell(k2(sumOf(it.months, (x) => x)), 'num')}
    </tr>`).join('');
    return `<tr class="section"><td colspan="3">${esc(sec.section)}</td>${sec.totals.map((t) => `<td>${k2(t)}</td>`).join('')}<td>${k2(sumOf(sec.totals, (x) => x))}</td></tr>${items}`;
  }).join('');
  return `<div class="status-line">Đơn vị USD'000K theo tháng. Sheet Opex Control trong file gốc không được nối với Cashflow; màn hình này cũng vậy.</div>
  <div class="table-wrap sticky"><table class="dense wide">
    <thead><tr>${['No', 'Khoản mục', 'Điều khoản', ...o.months, 'Tổng'].map((h) => hcell(esc(h))).join('')}</tr></thead>
    <tbody>${body}<tr class="strong"><td colspan="3">TỔNG</td>${o.grand.map((t) => `<td>${k2(t)}</td>`).join('')}<td>${k2(sumOf(o.grand, (x) => x))}</td></tr></tbody>
  </table></div>`;
}

// ---------- Data quality ----------
function quality(s) {
  const Q = s.Q;
  if (!Q) return `<div class="notice">Chưa tính được kiểm tra dữ liệu.</div>`;
  const miss = Q.missingFormula.map((x) => `<tr class="${x.stray ? 'bad-row' : ''}">
    ${cell(esc(x.item || '(không có mã)'))}${cell(x.row)}${cell(esc(x.text))}
    ${cell(money(Number(x.amount), x.currency))}${cell(esc(x.currency || '—'))}
    ${cell(esc(x.include))}
    ${cell(x.stray ? '' : `<button data-action="pay-resolve" data-id="${esc(x.id)}">${x.resolved ? 'Đã xử lý ✓' : 'Đánh dấu đã xử lý'}</button>`)}
  </tr>`).join('');
  const usd = Q.usdKCells.map((x) => `<tr>
    ${cell(esc(x.item))}${cell(x.row)}${cell(esc(x.kind), 'small')}
    ${cell(esc(x.formula || '(nhập tay)'), 'small muted')}
    ${cell(k2(x.fileValue))}${cell(k2(x.appValue))}${cell(k2(x.diffK))}
    ${cell(x.inForecast ? '<span class="pill warn">Có</span>' : '')}
  </tr>`).join('');
  const L = Q.opening;
  const bank = Q.bankNet;
  const row2158 = Q.usdKCells.find((x) => x.row === 2158);
  return `<div class="kpis">
    <div class="kpi"><div class="kl">Thiếu công thức (Z/AB/AD)</div><div class="kv">${fmtInt(Q.counts.missingFormula)}</div><div class="ks">kể cả 3 dòng rác</div></div>
    <div class="kpi"><div class="kl">Chưa xử lý</div><div class="kv">${fmtInt(Q.counts.unresolved)}</div><div class="ks">không vào kế hoạch</div></div>
    <div class="kpi"><div class="kl">USD'K nhập tay / sai dòng</div><div class="kv">${fmtInt(Q.counts.usdK)}</div><div class="ks">cột AK</div></div>
    <div class="kpi"><div class="kl">Chênh chi dự báo do AK</div><div class="kv num${negClass(Q.usdKForecastDiffK)}">${fmt2(Q.usdKForecastDiffK)}</div><div class="ks">USD'000K (file − app)</div></div>
  </div>
  <div class="card"><h3>Khác biệt có chủ ý so với file gốc</h3>
    <ul class="plain">
      <li><b>Liên kết số dư đầu kỳ V8:AC8.</b> File gốc lấy số dư đầu của tuần 11.1–12.4 từ cuối tuần cách 4 cột trước (V8 = R58…). App chuỗi đúng: mỗi tuần lấy cuối tuần trước. Nếu chọn “Như file gốc”, số dư cuối 11.1 cao hơn chuỗi đúng ${fmt2(L.endingDiffK[0])}; lệch lớn nhất ${fmt2(L.maxAbsK)} USD'000K.</li>
      <li><b>Cột AK (USD’K) của dòng 1453 (tuần 10.1)</b> nhập tay 24,52 thay công thức; app dùng số tính từ tiền và tỷ giá.</li>
      <li><b>Dòng 2158 (tuần 10.3)</b> dùng sai tham chiếu (cột D thay cột E), làm chi bị thiếu ${fmt2(-(row2158?.diffK ?? 0))} USD'000K.</li>
      <li><b>Weekly Plan.</b> Số dư cuối tuần của app cộng điều chỉnh ngân hàng (VND ${fmtInt(bank.vnd)}, USD ${fmt2(bank.usd)}); bảng Weekly trong file gốc không cộng.</li>
      <li><b>Thống kê Overview (C26:C28).</b> File gốc chỉ tính 48 dòng đầu (đến ${fmtDate(Q.overviewRange.excelRangeTo)}). App tính cả kỳ: ${fmtInt(Q.overviewRange.shortAll)} ngày dưới ngưỡng, thấp nhất VND ${fmtInt(Q.overviewRange.lowestAllVnd)}.</li>
      <li><b>Ngày bắt đầu kế hoạch để trống.</b> App lấy ngày sau đối chiếu gần nhất; file gốc luôn đi nhánh thủ công khi ô này trống.</li>
      <li><b>Opex Control</b> không nối với Cashflow trong file gốc; app giữ như vậy.</li>
    </ul>
  </div>
  <div class="card"><h3>Dữ liệu nguồn cần xem</h3>
    <ul class="plain">
      <li>Khoản không có danh mục (AJ) nhưng có trong tuần dự báo: <b>${fmtInt(Q.blankCategoryForecast.length)}</b> khoản, ${fmt2(sumOf(Q.blankCategoryForecast, (x) => x.usdK))} USD'000K — không vào Cashflow (file gốc cũng vậy).</li>
      <li>Danh mục “Others (R&amp;M, …)” là dòng tổng phụ (dòng 35) — khoản gắn nhãn này sẽ không vào Cashflow. Hiện có ${fmtInt(Q.othersSubtotalItems)} khoản; app đã ẩn nhãn này khỏi danh sách chọn.</li>
      <li>Dòng rác 4741–4743 (có số tiền, không có mã/ngày/tiền tệ): ${Q.stray.length} dòng, ${fmtInt(sumOf(Q.stray, (x) => x.amount))} — không vào kế hoạch.</li>
    </ul>
  </div>
  <div class="card"><h3>Khoản thiếu công thức trong file gốc</h3>
    <div class="table-wrap"><table class="dense"><thead><tr>${['Mã', 'Dòng', 'Vấn đề', 'Số tiền', 'TT', 'Trạng thái', 'Xử lý'].map((h) => hcell(h)).join('')}</tr></thead>
    <tbody>${miss || `<tr><td colspan="7" class="muted">Không có</td></tr>`}</tbody></table></div>
    <p class="muted">Khi đánh dấu “đã xử lý”, khoản được đưa vào kế hoạch (nếu hợp lệ). Hãy kiểm tra ngày và số tiền trước.</p>
  </div>
  <div class="card"><h3>Cột AK (USD’K) khác với app</h3>
    <div class="table-wrap"><table class="dense"><thead><tr>${['Mã', 'Dòng', 'Loại', 'Công thức/nhập tay', 'Giá trị file', 'Giá trị app', 'Chênh lệch', 'Trong dự báo'].map((h) => hcell(h)).join('')}</tr></thead>
    <tbody>${usd}</tbody></table></div>
  </div>`;
}
