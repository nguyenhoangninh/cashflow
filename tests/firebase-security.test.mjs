import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('Firestore rules have UID-bound roles and no browser-managed role escalation', () => {
  assert.match(rules, /match \/members\/\{uid\}/);
  assert.match(rules, /request\.auth\.uid == uid/);
  assert.match(rules, /allow list, create, update, delete: if false/);
  assert.match(rules, /email_verified == true/);
});
test('Firestore rules default deny and separate read/write/config privileges', () => {
  assert.match(rules, /function reader\(\)/);
  assert.match(rules, /function editor\(\)/);
  assert.match(rules, /function admin\(\)/);
  assert.match(rules, /match \/config\/\{id\}/);
  assert.match(rules, /id == 'main' && admin\(\)/);
  assert.match(rules, /match \/\{document=\*\*\} \{ allow read, write: if false; \}/);
  assert.doesNotMatch(rules, /allow read, write: if true/);
});
