import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { importWorkbook } from '../src/importer.js';

const XLSM = process.env.SVL_XLSM || '/mnt/user-data/uploads/165563b6-SVL_Payment_Ver6_Final_Ver_2.xlsm';
const haveFile = fs.existsSync(XLSM);

test('importer refuses a workbook whose header row has moved', { skip: !haveFile && 'needs SVL_XLSM' }, () => {
  const wb = XLSX.read(fs.readFileSync(XLSM), { type: 'buffer', cellFormula: true, cellDates: false });
  wb.Sheets['Payment Request List']['E2'].v = 'Số tiền';
  const tampered = XLSX.write(wb, { type: 'array', bookType: 'xlsm' });
  assert.throws(() => importWorkbook(XLSX, tampered), /Sai bố cục sheet "Payment Request List": ô E2/);
});
