// Kiểm tra dữ liệu nhập tay trước khi ghi. Hàm thuần: không đụng DOM hay Firebase.
// Mỗi hàm trả về { error, warnings }. error khác null nghĩa là không được ghi; warnings là
// cảnh báo người dùng có thể xác nhận rồi vẫn ghi.

export const CURRENCIES = ['VND', 'USD'];
export const FX_TYPES = ['SELL USD', 'BUY USD'];
export const DIRECTIONS = ['IN', 'OUT'];

const fail = (error) => ({ error, warnings: [] });
const ok = (warnings = []) => ({ error: null, warnings });
const isPositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const currencyOk = (c) => CURRENCIES.includes(String(c || 'VND').trim().toUpperCase());

// Khoản thanh toán. categories là danh sách danh mục được phép (cùng bộ lọc với ô chọn trên màn hình).
export function validatePayment(v, { payments = [], categories = [] } = {}) {
  if (!v.item) return fail('Nhập mã khoản.');
  const dup = payments.find((p) => norm(p.item) === norm(v.item));
  if (dup) return fail(`Mã khoản "${v.item}" đã có trong danh sách. Dùng mã khác hoặc sửa dòng cũ.`);
  if (!isPositive(v.amount)) return fail('Số tiền phải lớn hơn 0.');
  if (!currencyOk(v.currency)) return fail('Tiền tệ phải là VND hoặc USD.');
  if (!v.category) return fail('Chọn danh mục. Khoản không có danh mục sẽ không vào Cashflow.');
  if (categories.length && !categories.map((c) => c.trim()).includes(String(v.category).trim())) {
    return fail('Danh mục không nằm trong danh sách.');
  }
  if (v.reqDate && v.dueDate && v.dueDate < v.reqDate) return fail('Hạn thanh toán không được trước ngày yêu cầu.');
  return ok();
}

// Khoản thu. existingCategories là các danh mục thu đã có; danh mục mới chỉ cảnh báo, không chặn.
export function validateReceipt(v, { existingCategories = [] } = {}) {
  if (!v.date) return fail('Nhập ngày.');
  if (!isPositive(v.amount)) return fail('Số tiền phải lớn hơn 0.');
  if (!currencyOk(v.currency)) return fail('Tiền tệ phải là VND hoặc USD.');
  if (!v.category) return fail('Nhập danh mục thu. Khoản không có danh mục sẽ không vào Cashflow.');
  const warnings = [];
  if (existingCategories.length && !existingCategories.includes(String(v.category).trim())) {
    warnings.push(`Danh mục "${v.category}" chưa có trong các khoản thu hiện có. Kiểm tra chính tả trước khi thêm.`);
  }
  return ok(warnings);
}

// Giao dịch FX. Nếu nhập VND, cảnh báo khi lệch quá 1% so với USD × tỷ giá.
export function validateFx(v) {
  if (!v.date) return fail('Nhập ngày.');
  if (!isPositive(v.usd)) return fail('USD phải lớn hơn 0.');
  if (!isPositive(v.rate)) return fail('Tỷ giá phải lớn hơn 0.');
  if (!FX_TYPES.includes(String(v.type || '').trim())) return fail('Chọn loại SELL USD hoặc BUY USD.');
  const warnings = [];
  if (v.vnd != null && v.vnd !== '') {
    if (!isPositive(v.vnd)) return fail('VND phải lớn hơn 0 (hoặc để trống).');
    const expect = v.usd * v.rate;
    const gap = Math.abs(v.vnd - expect) / expect;
    if (gap > 0.01) warnings.push(`VND lệch ${(gap * 100).toFixed(1)}% so với USD × tỷ giá. Kiểm tra lại số.`);
  }
  return ok(warnings);
}

// Điều chỉnh ngân hàng: số tiền luôn dương, dấu được quyết định bởi chiều IN/OUT.
export function validateBankAdj(v) {
  if (!v.date) return fail('Nhập ngày.');
  if (!isPositive(v.amount)) return fail('Số tiền phải lớn hơn 0. Chiều IN/OUT quyết định dấu.');
  if (!currencyOk(v.currency)) return fail('Tiền tệ phải là VND hoặc USD.');
  if (!DIRECTIONS.includes(String(v.direction || '').trim().toUpperCase())) return fail('Chọn chiều IN hoặc OUT.');
  return ok();
}

// Dispatch theo tên bộ sưu tập (receipts, fx, bankAdj). ds là dataset hiện tại.
export function validateCrud(coll, v, ds = {}) {
  if (coll === 'receipts') {
    const existingCategories = [...new Set((ds.receipts || []).map((r) => String(r.category || '').trim()).filter(Boolean))];
    return validateReceipt(v, { existingCategories });
  }
  if (coll === 'fx') return validateFx(v);
  if (coll === 'bankAdj') return validateBankAdj(v);
  return fail(`Không biết bộ dữ liệu "${coll}".`);
}

// Số dòng nhập tay sẽ bị thay khi nhập lại file Excel. Dùng để hiện trong hộp xác nhận.
export function replacedCounts(ds = {}) {
  const payments = ds.payments || [];
  return {
    payments: payments.length,
    manualPayments: payments.filter((p) => p.manual).length,
    receipts: (ds.receipts || []).length,
    fx: (ds.fx || []).length,
    bankAdj: (ds.bankAdj || []).length,
  };
}

// Khoảng kế hoạch. planStart trống nghĩa là tự động (theo đối chiếu gần nhất); planEnd là bắt buộc.
// Ngày bắt đầu không được trước ngày số dư đầu: engine sẽ kéo về ngày số dư đầu và người dùng không thấy được.
export function validatePlanRange(v, { openingDate = null } = {}) {
  if (!v.planEnd) return fail('Ngày kết thúc kế hoạch là bắt buộc.');
  if (v.planStart && openingDate && v.planStart < openingDate) {
    return fail(`Ngày bắt đầu không được trước ngày số dư đầu (${openingDate.split('-').reverse().join('/')}).`);
  }
  if (v.planStart && v.planStart > v.planEnd) return fail('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
  return ok();
}
