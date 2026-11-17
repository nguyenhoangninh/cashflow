import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePayment, validateReceipt, validateFx, validateBankAdj, validateCrud, replacedCounts } from '../src/validate.js';

const CATS = ['Travelling', 'Repairs & Maintenance'];
const okPayment = { item: 'NEW-001', amount: 1000, currency: 'VND', category: 'Travelling', reqDate: '2026-11-01', dueDate: '2026-11-10' };

test('payment: a complete entry passes', () => {
  assert.deepEqual(validatePayment(okPayment, { payments: [], categories: CATS }), { error: null, warnings: [] });
});

test('payment: missing code, zero or negative amount, bad currency and missing category are refused', () => {
  const run = (patch) => validatePayment({ ...okPayment, ...patch }, { payments: [], categories: CATS }).error;
  assert.match(run({ item: '' }), /mã khoản/);
  assert.match(run({ amount: 0 }), /lớn hơn 0/);
  assert.match(run({ amount: -5 }), /lớn hơn 0/);
  assert.match(run({ amount: null }), /lớn hơn 0/);
  assert.match(run({ currency: 'EUR' }), /VND hoặc USD/);
  assert.match(run({ category: '' }), /Chọn danh mục/);
  assert.match(run({ category: 'Không có trong danh sách' }), /không nằm trong danh sách/);
});

test('payment: a code that already exists is refused, ignoring case and extra spaces', () => {
  const payments = [{ item: 'ABC-1' }];
  assert.match(validatePayment({ ...okPayment, item: '  abc-1 ' }, { payments, categories: CATS }).error, /đã có/);
});

test('payment: due date before the request date is refused', () => {
  assert.match(validatePayment({ ...okPayment, dueDate: '2026-10-01' }, { payments: [], categories: CATS }).error, /trước ngày yêu cầu/);
});

test('receipt: a new category only warns, a known one passes silently', () => {
  const base = { date: '2026-11-01', amount: 500, currency: 'USD', category: 'Customer Deposit' };
  const known = validateReceipt(base, { existingCategories: ['Customer Deposit'] });
  assert.equal(known.error, null);
  assert.deepEqual(known.warnings, []);
  const typo = validateReceipt({ ...base, category: 'Customer Deposti' }, { existingCategories: ['Customer Deposit'] });
  assert.equal(typo.error, null);
  assert.equal(typo.warnings.length, 1);
});

test('receipt: category is required, amount must be positive', () => {
  assert.match(validateReceipt({ date: '2026-11-01', amount: 5, currency: 'VND', category: '' }).error, /danh mục thu/);
  assert.match(validateReceipt({ date: '2026-11-01', amount: 0, currency: 'VND', category: 'x' }).error, /lớn hơn 0/);
});

test('fx: direction, rates and a VND figure far from USD x rate are checked', () => {
  const base = { date: '2026-11-01', type: 'SELL USD', usd: 1000, rate: 26000 };
  assert.equal(validateFx(base).error, null);
  assert.match(validateFx({ ...base, type: 'SWAP' }).error, /SELL USD hoặc BUY USD/);
  assert.match(validateFx({ ...base, rate: 0 }).error, /Tỷ giá/);
  assert.equal(validateFx({ ...base, vnd: 26000000 }).warnings.length, 0);
  assert.equal(validateFx({ ...base, vnd: 25000000 }).warnings.length, 1);
});

test('bank adjustment: the sign comes from the direction, so the amount must be positive', () => {
  const base = { date: '2026-11-01', currency: 'VND', direction: 'OUT', amount: 100 };
  assert.equal(validateBankAdj(base).error, null);
  assert.match(validateBankAdj({ ...base, amount: -100 }).error, /lớn hơn 0/);
  assert.match(validateBankAdj({ ...base, direction: 'IN/OUT' }).error, /IN hoặc OUT/);
});

test('validateCrud dispatches by collection and rejects unknown ones', () => {
  assert.match(validateCrud('unknown', {}, {}).error, /Không biết/);
  assert.match(validateCrud('fx', {}, {}).error, /Nhập ngày/);
});

test('replacedCounts reports how many hand-entered payments an import would remove', () => {
  const c = replacedCounts({ payments: [{ manual: true }, {}, {}], receipts: [{}], fx: [], bankAdj: [{}, {}] });
  assert.deepEqual(c, { payments: 3, manualPayments: 1, receipts: 1, fx: 0, bankAdj: 2 });
});

import { validatePlanRange } from '../src/validate.js';

test('plan range: end is required, start must not be before the opening date or after the end', () => {
  const open = '2026-08-01';
  assert.equal(validatePlanRange({ planStart: null, planEnd: '2026-12-31' }, { openingDate: open }).error, null);
  assert.equal(validatePlanRange({ planStart: '2026-08-15', planEnd: '2026-12-31' }, { openingDate: open }).error, null);
  assert.match(validatePlanRange({ planStart: null, planEnd: null }, { openingDate: open }).error, /kết thúc/);
  assert.match(validatePlanRange({ planStart: '2026-07-20', planEnd: '2026-12-31' }, { openingDate: open }).error, /trước ngày số dư đầu/);
  assert.match(validatePlanRange({ planStart: '2026-09-01', planEnd: '2026-08-15' }, { openingDate: open }).error, /trước hoặc bằng/);
  assert.equal(validatePlanRange({ planStart: '2026-08-01', planEnd: '2026-08-01' }, { openingDate: open }).error, null);
});
