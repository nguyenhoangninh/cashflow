// Formatting helpers for the UI. Numbers use ',' for thousands and '.' for decimals. Pure functions, no DOM.

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// VND and other whole amounts: 1,234,567 (never prints "-0")
export function fmtInt(v) {
  if (!isNum(v)) return '';
  const r = Math.round(v);
  return nf0.format(r === 0 ? 0 : r);
}

// USD amounts and USD'000K values: 1,234.56
export function fmt2(v) {
  if (!isNum(v)) return '';
  return nf2.format(Math.abs(v) < 0.005 ? 0 : v);
}

export function fmtAmt(v, currency) {
  return (currency || '').toUpperCase() === 'USD' ? fmt2(v) : fmtInt(v);
}

// ISO key 'YYYY-MM-DD' -> 'DD/MM/YYYY'
export function fmtDate(key) {
  if (!key || typeof key !== 'string') return '';
  const [y, m, d] = key.split('-');
  return d && m && y ? `${d}/${m}/${y}` : key;
}

// Escape text for HTML content and attributes
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export const negClass = (v) => (isNum(v) && v < -0.005 ? ' neg' : '');

// Input helpers: numbers from <input type="number">; thousands separators are ignored; empty string -> null
export function toNum(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(String(raw).replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export const toText = (raw) => (raw == null ? '' : String(raw).trim());
export const toDate = (raw) => {
  const s = toText(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
