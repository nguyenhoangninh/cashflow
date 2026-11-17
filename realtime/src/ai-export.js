// Explicit, privacy-aware, read-only export. No network or storage access.
export const AI_SCHEMA = 'svl.cashflow.ai.v1';
const numeric = (n) => n == null || n === '' ? null : (Number.isFinite(Number(n)) ? Number(n) : null);
const date = (v) => v == null ? null : String(v).slice(0, 10);
const short = (v) => v == null ? null : String(v).slice(0, 100);

/** User-initiated, allowlisted export. Never serializes raw records. */
export function buildAiPackage(ds, calc, quality = null, { level = 'summary', exportedAt = null } = {}) {
  if (!ds || !calc?.plan || !calc?.ctx || !Array.isArray(calc.plan.days)) throw new Error('Không có dữ liệu Cashflow đã tính để xuất.');
  if (!['summary', 'detail'].includes(level)) throw new Error('Chế độ xuất không hợp lệ.');
  if (calc.plan.error) throw new Error('Kế hoạch đang có lỗi; vui lòng kiểm tra trước khi xuất.');

  const o = calc.plan.overview || {};
  const payments = calc.ctx.payments || [];
  const counts = {};
  for (const p of payments) {
    const key = p.include === 'Yes' || p.include === 'Paid' || p.include === 'Review'
      ? p.include : 'Other';
    counts[key] = (counts[key] || 0) + 1;
  }

  const snapshot = {
    schema: AI_SCHEMA,
    classification: 'SVL_INTERNAL_FINANCIAL_DATA',
    transfer: 'manual-download-only',
    level,
    exportedAt: exportedAt ?? new Date().toISOString(),
    privacy: 'Excludes bank account numbers, payee names, free-text notes and descriptions. Review before sharing.',
    period: { opening: date(ds.settings?.openingDate), start: date(calc.plan.start), end: date(calc.plan.end) },
    thresholds: { minVnd: numeric(calc.ctx.minVnd), minUsd: numeric(calc.ctx.minUsd) },
    overview: {
      openingVnd: numeric(o.openingVnd), openingUsd: numeric(o.openingUsd),
      lowestVnd: numeric(o.lowestVnd), lowestUsd: numeric(o.lowestUsd),
      shortfallDays: numeric(o.shortfallDays), payablesCount: numeric(o.payablesCount),
      payablesVnd: numeric(o.payablesVnd), payablesUsd: numeric(o.payablesUsd),
      receiptsVnd: numeric(o.receiptsVnd), receiptsUsd: numeric(o.receiptsUsd),
      reviewCount: numeric(o.reviewCount), reviewVnd: numeric(o.reviewVnd),
      reviewUsd: numeric(o.reviewUsd),
    },
    paymentStatusCounts: counts,
    daily: calc.plan.days.map(d => ({
      date: date(d.date), inVnd: numeric(d.inVnd), outVnd: numeric(d.outVnd),
      closeVnd: numeric(d.closeVnd), inUsd: numeric(d.inUsd), outUsd: numeric(d.outUsd),
      closeUsd: numeric(d.closeUsd), shortVnd: numeric(d.shortVnd),
      shortUsd: numeric(d.shortUsd), alert: short(d.alert),
    })),
    weekly: (calc.weekly || []).map(w => ({
      code: short(w.code), from: date(w.from), to: date(w.to),
      inVnd: numeric(w.inVnd), outVnd: numeric(w.outVnd),
      inUsd: numeric(w.inUsd), outUsd: numeric(w.outUsd),
      endVnd: numeric(w.endVnd), endUsd: numeric(w.endUsd), alert: short(w.alert),
    })),
    cashflowSummary: (calc.cashflow?.rows || [])
      .filter(r => ['opening', 'sum_receipt', 'sum_opex', 'sum_capex', 'net', 'ending'].includes(r.type))
      .map(r => ({
        type: short(r.type), unit: 'USD_000',
        weeks: (calc.cashflow?.weeks || []).map((w, i) => ({
          code: short(w.code), actual: !!w.actual, value: numeric(r.values?.[i]),
        })),
      })),
    dataQuality: quality ? {
      unresolved: numeric(quality.counts?.unresolved),
      missingFormula: numeric(quality.counts?.missingFormula),
      usdKIssues: numeric(quality.counts?.usdK),
    } : null,
  };
  if (level === 'detail') {
    // Opt-in only. Do NOT add payee, bank account, invoice fields or free-text descriptions here.
    snapshot.paymentDetails = payments.map(p => ({
      reference: short(p.item), currency: short(p.currency), amount: numeric(p.amount),
      planDate: date(p.planDate), dueDate: date(p.dueDate),
      category: short(p.category), project: short(p.project),
      status: short(p.include), paid: !!p.actualDate,
    }));
  }
  return snapshot;
}
