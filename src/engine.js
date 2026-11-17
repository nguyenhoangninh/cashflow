// Pure calculation engine: reproduces the formulas of SVL_Payment_Ver6_Final_Ver_2.xlsm.
// No DOM, no Firebase. Runs in the browser (ES modules) and in Node for tests.
//
// Dates are ISO keys 'YYYY-MM-DD' (strings compare correctly as dates).
// Money: VND in dong, USD in dollars. Cashflow_Summary uses USD thousands ("USD'000K").

import { WEEKS, CATEGORIES, CASHFLOW_ROWS, CASHFLOW_ACTUALS, CASHFLOW_OPENING } from './structure.js';

const CLOSED_FLAGS = new Set(['old', 'cancel', 'cancelled', 'canceled', 'void']);
const ALERT_OK = 'OK';

// ---------- date helpers ----------
const pad = (n) => String(n).padStart(2, '0');

export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dateRange(from, to) {
  const out = [];
  if (!from || !to) return out;
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function dayOfWeek(key) {
  // Mon..Sun like CHOOSE(WEEKDAY(A,2), "Mon", ...)
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const js = new Date(key + 'T00:00:00Z').getUTCDay(); // 0=Sun
  return names[(js + 6) % 7];
}

export function weekMonday(key) {
  const js = new Date(key + 'T00:00:00Z').getUTCDay();
  return addDays(key, -((js + 6) % 7));
}

const maxKey = (a, b) => (a > b ? a : b);

// Map!A:E style lookups
// Exact containment (LOOKUP(2,1/((x>=start)*(x<=end)),code)) -> used for Payment "Actual"/"Week"
export function weekContaining(weeks, key) {
  if (!key) return '';
  for (const w of weeks) if (key >= w.start && key <= w.end) return w.code;
  return '';
}
// Approximate VLOOKUP on start date (Receipts!G, FX!I, Bank Adjustments!I)
export function weekApprox(weeks, key) {
  if (!key) return '';
  let found = '';
  for (const w of weeks) if (w.start <= key) found = w.code;
  return found;
}

// ---------- payments ----------
// Reproduces Payment Request List columns Z (Est. Payment Date), AA..AK.
export function derivePayment(p, c) {
  const cur = (p.currency || '').trim().toUpperCase();
  const flagText = (p.actualRaw || '').trim();
  const fs = c.forecastStart;

  let est = null;
  if (p.actualDate) est = p.actualDate;
  else if (p.lenaPlanDate) est = maxKey(p.lenaPlanDate, fs);
  else if (p.dueDate) est = maxKey(p.dueDate, fs);
  else if (p.reqDate) est = maxKey(p.reqDate, fs);

  let include;
  if (cur !== 'VND' && cur !== 'USD') include = '—';
  else if (p.dataIssue && !p.issueResolved) include = 'Lỗi dữ liệu';
  else if (p.actualDate) include = 'Paid';
  else if (CLOSED_FLAGS.has(flagText.toLowerCase())) include = 'No';
  else if (!est) include = '—';
  else if (est > c.scopeEnd) include = '—';
  else if (flagText !== '') include = 'Review';
  else include = 'Yes';

  const inPlan = include === 'Yes' || include === 'Paid';
  const planDate = inPlan ? (p.actualDate || est) : null; // AD
  const detail = inPlan && !!planDate && planDate >= c.ddStart; // AE

  let overdueFlag = '';
  if (!p.actualDate) {
    if (p.lenaPlanDate) {
      if (p.lenaPlanDate < fs) overdueFlag = '⚠ Overdue (Lena plan in past) → Forecast Start';
    } else if (p.dueDate && p.dueDate < fs) {
      overdueFlag = '⚠ Overdue (Due Date passed) → Forecast Start';
    }
  }

  const amount = Number(p.amount) || 0;
  return {
    ...p,
    currency: cur,
    est,
    include,
    planDate,
    cashPlan: inPlan, // AG = "Y"
    dailyDetail: detail, // AE = "Y"
    overdueFlag,
    approved: p.approvedTom ? 'Yes' : 'No',
    weekActual: p.actualDate ? weekContaining(c.weeks, p.actualDate) : '',
    weekPlan: planDate ? weekContaining(c.weeks, planDate) : '',
    amountUsdK: cur === 'USD' ? amount / 1000 : amount / c.cfRate / 1000, // AK
  };
}

// ---------- context (Overview date controls) ----------
export function buildContext(ds, opts = {}) {
  const s = ds.settings;
  const today = opts.today || todayKey();
  const opening = s.openingDate;
  const scopeEnd = s.planEnd;
  const weeks = WEEKS;

  const recon = reconTotals(ds);
  let lastReconciled = null;
  for (const d of Object.keys(recon).sort()) {
    if (d <= today && recon[d].actVnd != null && recon[d].actUsd != null) lastReconciled = d;
  }

  // Overview!F5 effective daily plan start
  let start;
  let startMode;
  if (s.planStart) {
    start = s.planStart <= opening ? opening : s.planStart;
    startMode = 'MANUAL START';
  } else if (lastReconciled) {
    start = maxKey(addDays(lastReconciled, 1), opening);
    startMode = 'AUTO START';
  } else {
    start = opening;
    startMode = 'NO RECONCILED BALANCE';
  }
  // Overview!F10 effective forecast start
  const forecastStart = s.forecastStart || start;
  // Daily Details start (Overview!F15 fallback F5)
  const ddStart = s.dailyDetailsStart || start;

  const accounts = ds.accounts || [];
  const openVnd = sumBy(accounts.filter((a) => a.currency === 'VND'), (a) => a.balance);
  const openUsd = sumBy(accounts.filter((a) => a.currency === 'USD'), (a) => a.balance);

  const fxDefault = ds.fxDefaults || { sell: 26310, buy: 26250 };
  const c = {
    today,
    opening,
    scopeEnd,
    start,
    startMode,
    startAfterEnd: start > scopeEnd,
    forecastStart,
    ddStart,
    cfRate: s.cfRate || 26300,
    minVnd: s.minVnd ?? 200000000,
    minUsd: s.minUsd ?? 100000,
    tolVnd: s.tolVnd ?? 1000,
    tolUsd: s.tolUsd ?? 0.01,
    weeks,
    fxDefault,
    openVnd,
    openUsd,
    lastReconciled,
    recon,
  };
  c.payments = (ds.payments || []).map((p) => derivePayment(p, c));
  return c;
}

function sumBy(arr, f) {
  let t = 0;
  for (const x of arr) t += Number(f(x)) || 0;
  return t;
}

// Reconciliation!G / H : actual totals per date (null when no account entered)
export function reconTotals(ds) {
  const out = {};
  for (const [d, r] of Object.entries(ds.recon || {})) {
    const vnd = [r.uobVnd, r.vtVnd].filter((x) => x != null && x !== '');
    const usd = [r.uobUsd1, r.uobUsd2, r.vtUsd].filter((x) => x != null && x !== '');
    out[d] = {
      actVnd: vnd.length ? vnd.reduce((a, b) => a + Number(b), 0) : null,
      actUsd: usd.length ? usd.reduce((a, b) => a + Number(b), 0) : null,
    };
  }
  return out;
}

// ---------- aggregation helpers ----------
function addTo(map, key, val) {
  map[key] = (map[key] || 0) + val;
}

function aggregateFlows(ds, c) {
  const rcVnd = {}, rcUsd = {};
  for (const r of ds.receipts || []) {
    const cur = (r.currency || '').toUpperCase();
    if (cur === 'VND') addTo(rcVnd, r.date, Number(r.amount) || 0);
    else if (cur === 'USD') addTo(rcUsd, r.date, Number(r.amount) || 0);
  }
  const pyVnd = {}, pyUsd = {};
  for (const p of c.payments) {
    if (!p.cashPlan || !p.planDate) continue;
    const amt = Number(p.amount) || 0;
    if (p.currency === 'VND') addTo(pyVnd, p.planDate, amt);
    else if (p.currency === 'USD') addTo(pyUsd, p.planDate, amt);
  }
  const fxSellUsd = {}, fxBuyUsd = {}, fxSellVnd = {}, fxBuyVnd = {};
  for (const f of ds.fx || []) {
    if (f.type === 'SELL USD') {
      addTo(fxSellUsd, f.date, Number(f.usd) || 0);
      addTo(fxSellVnd, f.date, Number(f.vnd) || 0);
    } else if (f.type === 'BUY USD') {
      addTo(fxBuyUsd, f.date, Number(f.usd) || 0);
      addTo(fxBuyVnd, f.date, Number(f.vnd) || 0);
    }
  }
  const bkVnd = { IN: {}, OUT: {} }, bkUsd = { IN: {}, OUT: {} };
  for (const b of ds.bankAdj || []) {
    const amt = Number(b.amount) || 0;
    const dir = (b.direction || '').toUpperCase();
    const cur = (b.currency || '').toUpperCase();
    if (cur === 'VND') addTo(bkVnd[dir] || (bkVnd[dir] = {}), b.date, amt);
    else if (cur === 'USD') addTo(bkUsd[dir] || (bkUsd[dir] = {}), b.date, amt);
  }
  return { rcVnd, rcUsd, pyVnd, pyUsd, fxSellUsd, fxBuyUsd, fxSellVnd, fxBuyVnd, bkVnd, bkUsd };
}

// Last SELL row (table order) with date <= start -> rate column D, else default sell (FX!B3)
function firstSellRate(ds, start, fallback) {
  let rate = null;
  for (const f of ds.fx || []) {
    if (f.type === 'SELL USD' && f.date <= start && f.rate != null) rate = Number(f.rate);
  }
  return rate ?? fallback;
}

// ---------- Daily Plan ----------
export function computePlan(ds, c) {
  const plan = {
    status: c.startMode,
    start: c.start,
    end: c.scopeEnd,
    days: [],
    overview: {},
    error: null,
  };

  if (c.startAfterEnd) {
    plan.error = 'START DATE AFTER PLAN END';
    return plan;
  }

  // Opening for the first day (Overview!F6 / F7)
  let openVnd, openUsd;
  if (c.start === c.opening) {
    openVnd = c.openVnd;
    openUsd = c.openUsd;
  } else {
    const prior = c.recon[addDays(c.start, -1)];
    if (!prior || prior.actVnd == null || prior.actUsd == null) {
      plan.error = 'PRIOR-DAY ACTUAL BALANCE REQUIRED';
      plan.status = '⚠ PRIOR-DAY ACTUAL BALANCE REQUIRED';
      return plan;
    }
    openVnd = prior.actVnd;
    openUsd = prior.actUsd;
  }

  const A = aggregateFlows(ds, c);
  const days = dateRange(c.start, c.scopeEnd);
  let prevN = openVnd;
  let prevR = openUsd;
  let prevJ = firstSellRate(ds, c.start, c.fxDefault.sell);
  let prevK = c.fxDefault.buy;
  let firstJ = null;

  for (const d of days) {
    const F = A.rcVnd[d] || 0; // In VND
    const G = A.pyVnd[d] || 0; // Out VND
    const H = A.fxSellUsd[d] || 0; // Sell USD
    const I = A.fxBuyUsd[d] || 0; // Buy USD
    const L = A.fxSellVnd[d] || 0; // VND in (sell USD)
    const M = A.fxBuyVnd[d] || 0; // VND out (buy USD)
    const W = A.bkVnd.IN[d] || 0;
    const X = A.bkVnd.OUT[d] || 0;
    const P = A.rcUsd[d] || 0;
    const Q = A.pyUsd[d] || 0;
    const Y = A.bkUsd.IN[d] || 0;
    const Z = A.bkUsd.OUT[d] || 0;

    const J = H > 0 ? L / H : prevJ;
    const K = I > 0 ? M / I : prevK;
    if (firstJ == null) firstJ = J;

    const E = prevN; // Opening VND
    const O = prevR; // Opening USD
    const N = E + F - G + L - M + W - X; // Closing VND
    const R = O + P - Q - H + I + Y - Z; // Closing USD
    const S = R + N / J; // Total ending balance in USD
    const T = N >= c.minVnd && R >= c.minUsd ? ALERT_OK : [
      N < c.minVnd ? '⚠ SHORT VND' : '',
      R < c.minUsd ? '⚠ SHORT USD' : '',
    ].join(' ').trim();

    plan.days.push({
      date: d,
      day: dayOfWeek(d),
      week: weekMonday(d),
      openVnd: E, inVnd: F, outVnd: G, sellUsd: H, buyUsd: I,
      sellRate: J, buyRate: K, vndIn: L, vndOut: M,
      closeVnd: N,
      openUsd: O, inUsd: P, outUsd: Q, closeUsd: R,
      totalUsd: S, alert: T,
      netVnd: F - G + L - M + W - X, netUsd: P - Q - H + I + Y - Z,
      bankInVnd: W, bankOutVnd: X, bankInUsd: Y, bankOutUsd: Z,
      shortVnd: N < c.minVnd ? c.minVnd - N : 0,
      shortUsd: R < c.minUsd ? c.minUsd - R : 0,
    });
    prevN = N;
    prevR = R;
    prevJ = J;
    prevK = K;
  }

  // Overview summary (computed over the full plan range; see notes)
  const byDate = plan.days;
  const firstRate = firstJ ?? prevJ;
  const minVnd = byDate.length ? Math.min(...byDate.map((x) => x.closeVnd)) : null;
  const minUsd = byDate.length ? Math.min(...byDate.map((x) => x.closeUsd)) : null;
  const shortDays = byDate.filter((x) => x.alert !== ALERT_OK).length;
  const included = c.payments.filter((p) => p.include === 'Yes');
  const review = c.payments.filter((p) => p.include === 'Review');
  const rc = ds.receipts || [];
  plan.overview = {
    openingVnd: c.openVnd,
    openingUsd: c.openUsd,
    usdToVndAtDay1: c.openUsd * firstRate,
    totalLiquidityVnd: c.openVnd + c.openUsd * firstRate,
    lowestVnd: minVnd,
    lowestUsd: minUsd,
    shortfallDays: shortDays,
    payablesVnd: sumBy(included.filter((p) => p.currency === 'VND'), (p) => p.amount),
    payablesUsd: sumBy(included.filter((p) => p.currency === 'USD'), (p) => p.amount),
    payablesCount: included.length,
    reviewVnd: sumBy(review.filter((p) => p.currency === 'VND'), (p) => p.amount),
    reviewUsd: sumBy(review.filter((p) => p.currency === 'USD'), (p) => p.amount),
    reviewCount: review.length,
    receiptsVnd: sumBy(rc.filter((r) => (r.currency || '').toUpperCase() === 'VND'), (r) => r.amount),
    receiptsUsd: sumBy(rc.filter((r) => (r.currency || '').toUpperCase() === 'USD'), (r) => r.amount),
    firstSellRate: firstRate,
  };
  plan.receiptRate = firstRate; // Receipts!I2 = 'Daily Plan'!J5
  return plan;
}

// ---------- Reconciliation ----------
export function computeReconciliation(ds, c, plan) {
  const planByDate = {};
  for (const d of plan.days) planByDate[d.date] = d;
  const bkNetVnd = {}, bkNetUsd = {};
  for (const b of ds.bankAdj || []) {
    const sign = (b.direction || '').toUpperCase() === 'IN' ? 1 : -1;
    const v = sign * (Number(b.amount) || 0);
    if ((b.currency || '').toUpperCase() === 'VND') addTo(bkNetVnd, b.date, v);
    else if ((b.currency || '').toUpperCase() === 'USD') addTo(bkNetUsd, b.date, v);
  }
  const dates = new Set([
    ...Object.keys(c.recon),
    ...dateRange(c.opening, addDays(c.opening, 177)),
  ]);
  const rows = [];
  for (const d of [...dates].sort()) {
    const act = c.recon[d] || { actVnd: null, actUsd: null };
    const pd = planByDate[d];
    let planVnd, planUsd;
    if (d < c.start) {
      planVnd = act.actVnd;
      planUsd = act.actUsd;
    } else if (pd) {
      planVnd = pd.closeVnd;
      planUsd = pd.closeUsd;
    } else {
      planVnd = null;
      planUsd = null;
    }
    const diffVnd = act.actVnd != null && planVnd != null ? act.actVnd - planVnd : null;
    const diffUsd = act.actUsd != null && planUsd != null ? act.actUsd - planUsd : null;
    let status = '';
    if (diffVnd != null || diffUsd != null) {
      const okV = diffVnd == null || Math.abs(diffVnd) <= c.tolVnd;
      const okU = diffUsd == null || Math.abs(diffUsd) <= c.tolUsd;
      status = okV && okU ? ALERT_OK : 'CHECK';
    }
    const raw = ds.recon?.[d];
    rows.push({
      date: d,
      actVnd: act.actVnd,
      actUsd: act.actUsd,
      planVnd,
      diffVnd,
      bankNetVnd: bkNetVnd[d] || 0,
      netDiffVnd: diffVnd,
      planUsd,
      diffUsd,
      bankNetUsd: bkNetUsd[d] || 0,
      netDiffUsd: diffUsd,
      status,
      notes: raw?.notes || '',
    });
  }
  return rows;
}

// ---------- Weekly Plan ----------
export function computeWeekly(ds, c, plan) {
  const A = aggregateFlows(ds, c);
  const planByDate = {};
  for (const d of plan.days) planByDate[d.date] = d;
  const inRange = (d, a, b) => d >= a && d <= b;
  const rows = [];
  for (const w of WEEKS) {
    const sum = (obj, from, to) => {
      let t = 0;
      for (const [k, v] of Object.entries(obj)) if (inRange(k, from, to)) t += v;
      return t;
    };
    const dayRows = plan.days.filter((d) => inRange(d.date, w.start, w.end));
    const inVnd = sum(A.rcVnd, w.start, w.end);
    const outVnd = sum(A.pyVnd, w.start, w.end);
    const inUsd = sum(A.rcUsd, w.start, w.end);
    const outUsd = sum(A.pyUsd, w.start, w.end);
    const sellUsd = dayRows.reduce((a, d) => a + d.sellUsd, 0);
    const buyUsd = dayRows.reduce((a, d) => a + d.buyUsd, 0);
    const netFx = dayRows.reduce((a, d) => a + d.vndIn - d.vndOut, 0);

    let endVnd = '', endUsd = '';
    if (w.end >= c.opening) {
      const to = w.end;
      const fxRows = plan.days.filter((d) => d.date >= c.opening && d.date <= to);
      const bankVnd = sum(A.bkVnd.IN, c.opening, to) - sum(A.bkVnd.OUT, c.opening, to);
      const bankUsd = sum(A.bkUsd.IN, c.opening, to) - sum(A.bkUsd.OUT, c.opening, to);
      endVnd = c.openVnd
        + sum(A.rcVnd, c.opening, to) - sum(A.pyVnd, c.opening, to)
        + fxRows.reduce((a, d) => a + d.vndIn - d.vndOut, 0)
        + bankVnd;
      endUsd = c.openUsd
        + sum(A.rcUsd, c.opening, to) - sum(A.pyUsd, c.opening, to)
        - fxRows.reduce((a, d) => a + d.sellUsd, 0) + fxRows.reduce((a, d) => a + d.buyUsd, 0)
        + bankUsd;
    }
    let alert = '';
    if (endVnd !== '') {
      alert = endVnd >= c.minVnd && endUsd >= c.minUsd ? ALERT_OK
        : [endVnd < c.minVnd ? '⚠ SHORT VND' : '', endUsd < c.minUsd ? '⚠ SHORT USD' : ''].join(' ').trim();
    }
    rows.push({
      code: w.code, from: w.start, to: w.end, label: w.label,
      inVnd, outVnd, sellUsd, buyUsd, netFx, inUsd, outUsd,
      endVnd, endUsd, alert,
    });
  }
  return rows;
}

// ---------- Cashflow_Summary (USD'000K) ----------
// Actual weeks (first 16 = Jun..Sep) come from stored values. Forecast weeks are computed from the
// payment list (AI week, AJ category, AL project, AK amount) and receipts (G week, J category, H USD).
// Opening of week i = ending of week i-1.
// Index of the first week (column V = week 11.1) affected by the source opening-link quirk.
const SOURCE_LINK_FROM = 20;

export function computeCashflow(ds, c, plan, opts = {}) {
  const actualWeeks = opts.actualWeeks ?? 16;
  const actuals = ds.cashflowActuals || CASHFLOW_ACTUALS;
  const openingStored = ds.cashflowOpening ?? CASHFLOW_OPENING;
  const receiptRate = plan.receiptRate ?? c.fxDefault.sell;

  const rcUsdByWeekCat = {};
  for (const r of ds.receipts || []) {
    const cur = (r.currency || '').toUpperCase();
    const usd = cur === 'USD' ? Number(r.amount) || 0 : (Number(r.amount) || 0) / receiptRate;
    const key = weekApprox(WEEKS, r.date) + '|' + (r.category || '');
    rcUsdByWeekCat[key] = (rcUsdByWeekCat[key] || 0) + usd;
  }
  const pyByWeekCat = {};
  const pyByWeekProj = {};
  for (const p of c.payments) {
    if (!p.weekPlan) continue;
    const k1 = p.weekPlan + '|' + (p.category || '');
    pyByWeekCat[k1] = (pyByWeekCat[k1] || 0) + p.amountUsdK;
    const k2 = p.weekPlan + '|' + (p.project || '');
    pyByWeekProj[k2] = (pyByWeekProj[k2] || 0) + p.amountUsdK;
  }

  const values = {};
  for (const row of CASHFLOW_ROWS) values[row.row] = new Array(WEEKS.length).fill(0);
  const sumRows = (i, list) => list.reduce((a, r) => a + values[r][i], 0);

  for (let i = 0; i < WEEKS.length; i++) {
    const wk = WEEKS[i].code;
    const isActual = i < actualWeeks;
    const set = (r, x) => { values[r][i] = x; };

    // Opening of week i = ending of week i-1 (typed openings in row 8 are display only).
    // Source-file quirk: Cashflow_Summary!V8:AC8 point 4 columns back (V8 = R58 ...).
    // Only used when opts.sourceOpeningLinks is set, to reproduce the Excel numbers for verification.
    if (i === 0) set(8, openingStored);
    else if (opts && opts.sourceOpeningLinks && i >= SOURCE_LINK_FROM) set(8, values[58][i - 4]);
    else set(8, values[58][i - 1]);

    if (isActual) {
      for (const row of CASHFLOW_ROWS) {
        const a = actuals[String(row.row)];
        if (a && a[i] != null) set(row.row, Number(a[i]));
      }
    } else {
      // capex project rows first: row 21 depends on them
      for (const row of CASHFLOW_ROWS) {
        if (row.type === 'capex' && row.key === 'project') {
          set(row.row, -(pyByWeekProj[wk + '|' + row.label] || 0));
        }
      }
      for (const row of CASHFLOW_ROWS) {
        const label = row.label;
        const r = row.row;
        switch (row.type) {
          case 'receipt':
            set(r, (rcUsdByWeekCat[wk + '|' + label] || 0) / 1000);
            break;
          case 'payable':
          case 'opex':
          case 'debt':
            if (r === 21) {
              // -SUMIFS(AJ = label) - SUM(R45:R49)
              set(r, -(pyByWeekCat[wk + '|' + label] || 0) - sumRows(i, [45, 46, 47, 48, 49]));
            } else {
              set(r, -(pyByWeekCat[wk + '|' + label] || 0));
            }
            break;
          case 'capex':
            if (row.key !== 'project') set(r, -(pyByWeekCat[wk + '|' + label] || 0));
            break;
          case 'opex_sub':
            break; // computed after the loop (sum of rows 36..42)
          case 'buffer':
            set(r, 0);
            break;
          default:
            break;
        }
      }
    }

    if (!isActual) set(35, sumRows(i, [36, 37, 38, 39, 40, 41, 42])); // actual weeks keep the stored subtotal
    set(15, sumRows(i, [10, 11, 12, 13, 14]));
    set(43, sumRows(i, [17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]));
    set(52, sumRows(i, [45, 46, 47, 48, 49, 50, 51]));
    set(57, values[15][i] + values[43][i] + values[52][i] + values[54][i] + values[55][i] + values[56][i]);
    // Ending always chains from the previous ending (as the file's row 58 does), except in source-link mode.
    const prevEnding = i === 0 ? openingStored : values[58][i - 1];
    const srcLink = !isActual && opts.sourceOpeningLinks && i >= SOURCE_LINK_FROM;
    set(58, (srcLink ? values[58][i - 4] : prevEnding) + values[57][i]);
  }

  return {
    weeks: WEEKS.map((w, i) => ({ code: w.code, from: w.start, to: w.end, label: w.label, actual: i < actualWeeks })),
    rows: CASHFLOW_ROWS.map((r) => ({ ...r, values: values[r.row] })),
  };
}

// ---------- Opex Control (standalone grid, USD'000K per month) ----------
export const OPEX_MONTHS = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function computeOpex(ds) {
  const items = ds.opex || [];
  const sections = {};
  for (const it of items) {
    const s = sections[it.section] || (sections[it.section] = { section: it.section, items: [], totals: new Array(7).fill(0) });
    s.items.push(it);
    it.months.forEach((v, i) => { s.totals[i] += Number(v) || 0; });
  }
  const list = Object.values(sections);
  const grand = new Array(7).fill(0);
  for (const s of list) s.totals.forEach((v, i) => { grand[i] += v; });
  return { months: OPEX_MONTHS, sections: list, grand };
}

// ---------- Daily Details (Daily Details sheet, built from the same rows) ----------
export function computeDailyDetails(c, plan) {
  const byDate = {};
  for (const p of c.payments) {
    if (!p.dailyDetail) continue;
    (byDate[p.planDate] ||= []).push(p);
  }
  const out = [];
  for (const d of plan.days) {
    if (d.date < c.ddStart) continue;
    const items = (byDate[d.date] || []).sort((a, b) => (a.item || '').localeCompare(b.item || '', undefined, { numeric: true }));
    const totVnd = items.filter((x) => x.currency === 'VND').reduce((a, x) => a + Number(x.amount), 0);
    const totUsd = items.filter((x) => x.currency === 'USD').reduce((a, x) => a + Number(x.amount), 0);
    out.push({
      date: d.date,
      openVnd: d.openVnd, openUsd: d.openUsd,
      items,
      totalVnd: totVnd, totalUsd: totUsd,
      closeVnd: d.openVnd - totVnd, closeUsd: d.openUsd - totUsd,
    });
  }
  return out;
}

// Suggest the FX deal that brings a short day back over the buffer (advice only, never saved).
export function suggestFx(day) {
  const out = {};
  if (day.shortVnd > 0 && day.sellRate > 0) out.sellUsd = Math.ceil(day.shortVnd / day.sellRate);
  if (day.shortUsd > 0) out.buyUsd = Math.ceil(day.shortUsd);
  return out;
}

// Convenience: run everything
export function runAll(ds, opts = {}) {
  const c = buildContext(ds, opts);
  const plan = computePlan(ds, c);
  const recon = computeReconciliation(ds, c, plan);
  const weekly = computeWeekly(ds, c, plan);
  const cashflow = computeCashflow(ds, c, plan, opts);
  const opex = computeOpex(ds);
  const details = computeDailyDetails(c, plan);
  return { ctx: c, plan, recon, weekly, cashflow, opex, details };
}

export { CATEGORIES, WEEKS, CASHFLOW_ROWS, ALERT_OK };
