# Nhật ký thay đổi

Phiên bản giao diện hiển thị ở trang Nhập dữ liệu (`BUILD_ID` trong `js/views.js`).

## khoa-ghi-de-2026-11-23 (giai đoạn 0–1 của audit)

- Tạm khóa ghi đè dữ liệu Firestore dùng chung (cờ `overwriteEnabled`, mặc định tắt).
- Khôi phục kiểm tra tiêu đề sheet Payment Request List (bị mất ở một commit release trước đó).
- Gỡ bản `realtime/` trùng lặp; `realtime/index.html` chỉ chuyển hướng về trang chính.
- Cập nhật README: mục bảo trì, mô tả `firestore.rules` là mẫu, bỏ mô tả cũ về ghi đè.
- Service worker dùng cache `svl-cashflow-shell-v14`.

## ghi-de-2026-11-22

- Ghi đè dữ liệu Firestore có xác nhận: so sánh số lượng, yêu cầu đã sao lưu, gõ cụm từ xác nhận, chỉ Admin.
- Trang nhập hiển thị phiên bản giao diện để phân biệt bản cache cũ.
- Nhập tay có kiểm tra (`src/validate.js`): khoản thanh toán, khoản thu, FX, điều chỉnh ngân hàng.
- Kế hoạch có ngày bắt đầu và ngày kết thúc; bảng chi tiết ngày hiển thị số tiền và loại tiền.
