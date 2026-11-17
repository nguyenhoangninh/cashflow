// Data-quality report: problems found in the source workbook and where the web app deliberately differs.
// Pure functions; the UI only renders what is returned here.

const FORECAST_FROM = 16; // Cashflow column index of week 10.1 (weeks 6.1..9.4 are actuals)
const CF_ENDING = 58;
const CF_NET = 57;
const CF_OPENING = 8;

const cfValues = (res, row) => res.cashflow.rows.find((r) => r.row === row).values;
const isIncluded = (p) => p.include === 'Yes' || p.include === 'Paid';
const cfIndexOf = (res, code) => res.cashflow.weeks.findIndex((w) => w.code === code);

export function buildQuality(ds, chain, source) {
  const payments = chain.ctx.payments;

  // 1. Rows the source file left without formulas (Include/Est/Plan date blank in Excel).
  const missingFormula = payments
    .filter((p) => p.dataIssue)
    .map((p) => ({
      id: p.id,
      item: p.item,
      row: p.sourceRow,
      stray: !p.item,
      currency: p.currency,
      amount: p.amount,
      include: p.include,
      resolved: !!p.issueResolved,
      text: p.dataIssue,
    }));

  // 2. USD'K cells (column AK) that are typed or point at the wrong row.
  const usdKCells = payments
    .filter((p) => p.akIssue)
    .map((p) => {
      const idx = p.weekPlan ? cfIndexOf(chain, p.weekPlan) : -1;
      const inForecast = isIncluded(p) && idx >= FORECAST_FROM;
      return {
        id: p.id,
        item: p.item,
        row: p.sourceRow,
        kind: p.akIssue,
        formula: p.akFormula,
        fileValue: p.akFile,
        appValue: p.amountUsdK,
        // Positive = the file shows more outflow than the app computes.
        diffK: p.akFile != null ? p.akFile - p.amountUsdK : null,
        inForecast,
        week: p.weekPlan || null,
      };
    });
  const usdKForecastDiffK = usdKCells
    .filter((x) => x.inForecast && x.diffK != null)
    .reduce((a, x) => a + x.diffK, 0);

  // 3. Included items whose category is blank: they never reach the Cashflow (same as the workbook).
  const blankCategoryForecast = payments
    .filter((p) => isIncluded(p) && !(p.category || '').trim())
    .map((p) => ({ item: p.item, row: p.sourceRow, week: p.weekPlan, usdK: p.amountUsdK, include: p.include }))
    .filter((x) => x.week && cfIndexOf(chain, x.week) >= FORECAST_FROM);

  // 4. Items tagged with the subtotal label (Cashflow row 35) would be dropped from the Cashflow.
  const othersSubtotal = payments.filter((p) => isIncluded(p) && p.weekPlan && (p.category || '').trim().startsWith('Others (R&M')).length;

  // 5. Opening-balance link in Cashflow_Summary!V8:AC8 (source) versus the chained default.
  const endChain = cfValues(chain, CF_ENDING);
  const endSrc = cfValues(source, CF_ENDING);
  const linkDiffs = [];
  for (let i = 20; i < 28; i++) linkDiffs.push(endSrc[i] - endChain[i]);
  const linkMaxAbs = Math.max(...linkDiffs.map((x) => Math.abs(x)));

  // 6. Weekly sheet: bank adjustments included in ending balances here, not in the workbook.
  const from = ds.settings.openingDate;
  const to = ds.settings.planEnd;
  const bankNet = (cur) => (ds.bankAdj || [])
    .filter((b) => (b.currency || '').toUpperCase() === cur && b.date >= from && b.date <= to)
    .reduce((a, b) => a + ((b.direction || '').toUpperCase() === 'IN' ? 1 : -1) * (Number(b.amount) || 0), 0);

  // 7. Overview statistics in the workbook cover Daily Plan rows 5..52 only.
  const days = chain.plan.days;
  const excelDays = days.slice(0, 48);
  const shortAll = days.filter((d) => d.alert !== 'OK').length;
  const shortExcel = excelDays.filter((d) => d.alert !== 'OK').length;

  // 8. Stray rows without item, currency or dates in the payment list.
  const stray = missingFormula.filter((x) => x.stray);

  return {
    missingFormula,
    usdKCells,
    usdKForecastDiffK,
    blankCategoryForecast,
    othersSubtotalItems: othersSubtotal,
    opening: {
      endingDiffK: linkDiffs,
      maxAbsK: linkMaxAbs,
    },
    bankNet: { vnd: bankNet('VND'), usd: bankNet('USD') },
    overviewRange: {
      shortAll,
      shortExcel,
      lowestAllVnd: Math.min(...days.map((d) => d.closeVnd)),
      lowestExcelVnd: Math.min(...excelDays.map((d) => d.closeVnd)),
      excelRangeTo: excelDays.length ? excelDays[excelDays.length - 1].date : null,
    },
    stray,
    counts: {
      missingFormula: missingFormula.length,
      unresolved: missingFormula.filter((x) => !x.resolved && !x.stray).length,
      usdK: usdKCells.length,
    },
  };
}
