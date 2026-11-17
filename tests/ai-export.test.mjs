import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAiPackage, AI_SCHEMA } from '../src/ai-export.js';
const ds = { settings: { openingDate: '2026-11-01' }, accounts: [{ account: 'SECRET_BANK_ACCOUNT' }] };
const calc = {
  ctx: { minVnd: 200, minUsd: 100, payments: [{ item: 'PR-1', include: 'Yes', amount: 500,
    currency: 'USD', planDate: '2026-11-17', payee: 'SECRET_SUPPLIER', description: 'SECRET_DESCRIPTION' }] },
  plan: { start: '2026-11-01', end: '2026-12-31', days: [{date:'2026-11-17', closeUsd: 200, closeVnd: 5000, alert:'OK'}],
    overview: { openingUsd: 1000, shortfallDays: 0, payablesCount: 1 } },
  weekly: [{ code:'11.3', endUsd: 200, endVnd:5000 }],
  cashflow: { rows: [{type:'ending',values:[7]}, {type:'payable',label:'SECRET_SUPPLIER',values:[5]}],
    weeks:[{code:'11.3',actual:false}] },
};
test('summary does not export individual payments or sensitive fields', () => {
  const result = buildAiPackage(ds, calc, null, {exportedAt:'2026-11-17T00:00:00Z'});
  assert.equal(result.schema, AI_SCHEMA);
  assert.equal(result.paymentDetails, undefined);
  assert.equal(result.daily[0].closeUsd, 200);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SUPPLIER|SECRET_DESCRIPTION|SECRET_BANK_ACCOUNT/);
});
test('detail mode requires deliberate selection and remains allowlisted', () => {
  const result = buildAiPackage(ds, calc, null, {level:'detail'});
  assert.equal(result.paymentDetails[0].reference, 'PR-1');
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SUPPLIER|SECRET_DESCRIPTION|SECRET_BANK_ACCOUNT/);
});
test('invalid and broken plans cannot be exported', () => {
  assert.throws(() => buildAiPackage(null, calc));
  assert.throws(() => buildAiPackage(ds, calc, null, {level:'raw'}));
  assert.throws(() => buildAiPackage(ds, {...calc, plan: {...calc.plan,error:'BAD'}}));
});
