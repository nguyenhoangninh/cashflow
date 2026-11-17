// Imports SVL_Payment_Ver6_Final_Ver_2.xlsm (or any file with the same layout) into the dataset.
// Works with SheetJS (xlsx). Usage: importWorkbook(XLSX, arrayBuffer) -> dataset.
// Supplier bank account numbers (Payment Request List column W) are NOT imported on purpose.

import { CATEGORIES } from './structure.js';

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export function serialToKey(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 1) return null;
  return new Date(EXCEL_EPOCH + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

export function toDateKey(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return serialToKey(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const txt = (v) => (v == null ? '' : String(v).trim());
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (v === '' || v == null ? null : (isFinite(Number(v)) ? Number(v) : null)));

export function importWorkbook(XLSX, buffer) {
  const wb = XLSX.read(buffer, {
    type: 'array',
    cellDates: false,
    cellFormula: true, // needed to detect rows whose formulas are missing in the source file
    cellNF: false,
    cellHTML: false,
    cellStyles: false,
    sheets: [
      'Overview', 'Opening Balances', 'Payment Request List', 'Receipts', 'FX Transactions',
      'Bank Adjustments', 'Reconciliation', 'Opex Control',
    ],
  });
  const need = (name) => {
    const ws = wb.Sheets[name];
    if (!ws) throw new Error(`Thiếu sheet "${name}" trong file.`);
    return ws;
  };
  const get = (ws) => (addr) => {
    const c = ws[addr];
    return c ? c.v : undefined;
  };

  const ov = get(need('Overview'));
  const ob = get(need('Opening Balances'));
  const pl = need('Payment Request List');
  const plg = get(pl);
  const rcWs = need('Receipts');
  const rcg = get(rcWs);
  const fxg = get(need('FX Transactions'));
  const bag = get(need('Bank Adjustments'));
  const rcn = get(need('Reconciliation'));
  const opx = get(need('Opex Control'));

  const settings = {
    openingDate: toDateKey(ov('F13')),
    planStart: toDateKey(ov('F14')),
    dailyDetailsStart: toDateKey(ov('F15')),
    planEnd: toDateKey(ov('F16')),
    forecastStart: toDateKey(ov('F17')),
    minVnd: num(ov('C9')) ?? 200000000,
    minUsd: num(ov('C10')) ?? 100000,
    tolVnd: num(rcn('G4')) ?? 1000,
    tolUsd: num(rcn('I4')) ?? 0.01,
    cfRate: num(opx('B2')) ?? 26300,
  };
  if (!settings.openingDate || !settings.planEnd) {
    throw new Error('Không đọc được ngày đầu kỳ hoặc ngày kết thúc (Overview F13, F16).');
  }

  // Opening balances (rows 6..10)
  const accounts = [
    { id: 'uob-vnd', bank: 'UOB Bank', name: 'Current Account', account: txt(ob('C6')), currency: 'VND', balance: num(ob('F6')) ?? 0 },
    { id: 'uob-usd', bank: 'UOB Bank', name: 'Current Account', account: txt(ob('C7')), currency: 'USD', balance: num(ob('E7')) ?? 0 },
    { id: 'uob-usd-inv', bank: 'UOB Bank', name: 'Investment Account', account: txt(ob('C8')), currency: 'USD', balance: num(ob('E8')) ?? 0 },
    { id: 'vtb-vnd', bank: 'VietinBank', name: 'Current Account', account: txt(ob('C9')), currency: 'VND', balance: num(ob('F9')) ?? 0 },
    { id: 'vtb-usd', bank: 'VietinBank', name: 'Current Account', account: txt(ob('C10')), currency: 'USD', balance: num(ob('E10')) ?? 0 },
  ];

  // Payment Request List (rows 3..last). Columns by letter; W (bank account) skipped.
  const payments = [];
  const seenIds = new Set();
  const lastPl = lastRowWithAny(pl, [2, 5], 3);
  for (let r = 3; r <= lastPl; r++) {
    const item = plg(`B${r}`);
    const amount = num(plg(`E${r}`));
    if ((item == null || item === '') && amount == null) continue;
    let id = item != null && item !== '' ? txt(item) : `row${r}`;
    if (seenIds.has(id)) id = `${id}-r${r}`;
    seenIds.add(id);
    const sRaw = plg(`S${r}`);
    const sDate = toDateKey(sRaw);
    // Source rows without formulas in Z/AB/AD are silently left out of the Excel plan.
    const abCell = pl[`AB${r}`];
    const hasFormula = !!(abCell && (abCell.f || (typeof abCell.v === 'string' && abCell.v.startsWith('='))));
    const aiCell = pl[`AI${r}`];
    const weekTyped = !!(aiCell && aiCell.v != null && !aiCell.f); // week typed over the formula
    // USD'K column (AK) must read amount E and currency F of the SAME row.
    const akCell = pl[`AK${r}`];
    const akF = akCell && akCell.f ? String(akCell.f) : null;
    let akIssue = null;
    if (akCell && akCell.v != null && !akF) akIssue = "USD'K nhập tay thay cho công thức";
    else if (akF && !(new RegExp(`\\$?E${r}(?!\\d)`).test(akF) && new RegExp(`\\$?F${r}(?!\\d)`).test(akF))) akIssue = `USD'K tham chiếu sai dòng/cột (${akF})`;
    else if (!akF && (akCell == null || akCell.v == null) && item != null && item !== '') akIssue = "USD'K và danh mục trống: không có công thức trong file gốc";
    payments.push({
      id,
      sourceRow: r,
      item: txt(item),
      type: txt(plg(`C${r}`)),
      todayDate: toDateKey(plg(`D${r}`)),
      amount: amount ?? 0,
      currency: txt(plg(`F${r}`)).toUpperCase(),
      requestor: txt(plg(`G${r}`)),
      poNo: txt(plg(`H${r}`)),
      payeeCode: txt(plg(`I${r}`)),
      payee: txt(plg(`J${r}`)),
      description: txt(plg(`K${r}`)),
      reqDate: toDateKey(plg(`L${r}`)),
      dueDate: toDateKey(plg(`M${r}`)),
      status: txt(plg(`N${r}`)),
      submittedDate: toDateKey(plg(`O${r}`)),
      approvedTom: toDateKey(plg(`P${r}`)),
      approvedRam: toDateKey(plg(`Q${r}`)),
      ibDate: toDateKey(plg(`R${r}`)),
      actualDate: sDate,
      actualRaw: sDate ? '' : txt(sRaw),
      drNo: txt(plg(`T${r}`)),
      remarks: txt(plg(`U${r}`)),
      dnNo: txt(plg(`V${r}`)),
      lenaPlanDate: toDateKey(plg(`X${r}`)),
      category: txt(plg(`AJ${r}`)),
      project: txt(plg(`AL${r}`)),
      dataIssue: hasFormula ? null : 'Thiếu công thức trong file gốc (Z/AB/AD trống): Excel không đưa khoản này vào kế hoạch.',
      weekTyped: weekTyped ? txt(aiCell.v) : null,
      akIssue,
      akFile: akCell && akCell.v != null && typeof akCell.v === 'number' ? akCell.v : null, // USD'K value as stored in the file
      akFormula: akF,
      issueResolved: false,
    });
  }

  // Receipts (rows 4..last)
  const receipts = [];
  const lastRc = lastRowWithAny(rcWs, [1, 5], 4);
  for (let r = 4; r <= lastRc; r++) {
    const amount = num(rcg(`E${r}`));
    const date = toDateKey(rcg(`A${r}`));
    if (amount == null || !date) continue;
    receipts.push({
      id: `rc-${r}`,
      date,
      description: txt(rcg(`B${r}`)),
      source: txt(rcg(`C${r}`)),
      currency: txt(rcg(`D${r}`)).toUpperCase(),
      amount,
      notes: txt(rcg(`F${r}`)),
      category: txt(rcg(`J${r}`)),
    });
  }

  // FX transactions (rows 6..last)
  const fx = [];
  const lastFx = lastRowWithAny(need('FX Transactions'), [1, 3], 6);
  for (let r = 6; r <= lastFx; r++) {
    const date = toDateKey(fxg(`A${r}`));
    const type = txt(fxg(`B${r}`)).toUpperCase();
    if (!date || !type) continue;
    fx.push({
      id: `fx-${r}`,
      date,
      type,
      usd: num(fxg(`C${r}`)) ?? 0,
      rate: num(fxg(`D${r}`)),
      vnd: num(fxg(`E${r}`)) ?? 0,
      bank: txt(fxg(`F${r}`)),
      ref: txt(fxg(`G${r}`)),
      notes: txt(fxg(`H${r}`)),
    });
  }

  // Bank adjustments (rows 4..last)
  const bankAdj = [];
  const lastBa = lastRowWithAny(need('Bank Adjustments'), [1, 6], 4);
  for (let r = 4; r <= lastBa; r++) {
    const date = toDateKey(bag(`A${r}`));
    const amount = num(bag(`F${r}`));
    if (!date || amount == null) continue;
    bankAdj.push({
      id: `ba-${r}`,
      date,
      bank: txt(bag(`B${r}`)),
      account: txt(bag(`C${r}`)),
      currency: txt(bag(`D${r}`)).toUpperCase(),
      direction: txt(bag(`E${r}`)).toUpperCase(),
      amount,
      type: txt(bag(`G${r}`)),
      notes: txt(bag(`H${r}`)),
    });
  }

  // Reconciliation actual balances (rows 23..200, date = opening + index)
  const recon = {};
  for (let r = 23; r <= 200; r++) {
    const idx = r - 23;
    const date = addDaysKey(settings.openingDate, idx);
    const row = {
      uobVnd: num(rcn(`B${r}`)),
      uobUsd1: num(rcn(`C${r}`)),
      uobUsd2: num(rcn(`D${r}`)),
      vtVnd: num(rcn(`E${r}`)),
      vtUsd: num(rcn(`F${r}`)),
      notes: txt(rcn(`Q${r}`)),
    };
    const hasInput = [row.uobVnd, row.uobUsd1, row.uobUsd2, row.vtVnd, row.vtUsd].some((x) => x != null);
    if (hasInput || row.notes) recon[date] = row;
  }

  // Opex Control (rows 6..77): items under roman-numeral section headers
  const opex = [];
  const opg = get(need('Opex Control'));
  let section = '';
  for (let r = 5; r <= 77; r++) {
    const a = txt(opg(`A${r}`));
    const b = txt(opg(`B${r}`));
    if (!b && a) { section = a.replace(/\s+/g, ' ').trim(); continue; }
    if (!b || /^TOTAL/i.test(b) || /^GRAND/i.test(b)) continue;
    opex.push({
      id: `opex-${r}`,
      row: r,
      section,
      no: a,
      name: b,
      terms: txt(opg(`C${r}`)),
      vndMonth: num(opg(`D${r}`)) ?? 0,
      months: ['E', 'F', 'G', 'H', 'I', 'J', 'K'].map((col) => num(opg(`${col}${r}`)) ?? 0),
    });
  }

  const fxDefaults = {
    sell: num(fxg('B3')) ?? 26310,
    buy: num(fxg('E3')) ?? 26250,
  };

  return {
    version: 1,
    source: 'SVL_Payment_Ver6_Final_Ver_2.xlsm',
    settings,
    accounts,
    fxDefaults,
    payments,
    receipts,
    fx,
    bankAdj,
    recon,
    opex,
    categories: CATEGORIES.slice(),
    importedAt: new Date().toISOString(),
  };
}

function lastRowWithAny(ws, cols, from) {
  const ref = ws['!ref'];
  if (!ref) return from;
  const range = refRange(ref);
  const letters = cols.map((c) => colLetter(c));
  let last = from;
  for (let r = from; r <= range.e.r + 1; r++) {
    for (const L of letters) {
      const c = ws[`${L}${r}`];
      if (c && c.v !== '' && c.v != null) { last = r; break; }
    }
  }
  return last;
}

function addDaysKey(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// tiny helpers for A1 refs (avoid depending on XLSX utils in tests)
function refRange(ref) {
  const [a, b] = ref.split(':');
  const parse = (s) => {
    const m = s.match(/^([A-Z]+)(\d+)$/);
    return { c: colIndex(m[1]), r: Number(m[2]) };
  };
  const s = parse(a);
  const e = b ? parse(b) : s;
  return { s, e: { r: e.r, c: e.c } };
}
function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function colLetter(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
