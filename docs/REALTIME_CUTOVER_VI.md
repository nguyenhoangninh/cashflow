# SVL Cashflow — Kế hoạch chuyển sang Firestore Realtime

Cập nhật: 17/11/2026. Dự án Firebase: `cashflow-aff9d`.
PR: https://github.com/nguyenhoangninh/cashflow/pull/1

## Trạng thái
- Google Authentication, authorized domain, Web App Config, Firestore Rules và `members/{UID}` Admin: chủ dự án đã thao tác trong Firebase Console.
- Đăng nhập Admin: chủ dự án xác nhận kiểm tra thành công.
- Ứng dụng Cashflow: phần kết nối Firestore Realtime / import lịch sử / trạng thái đồng bộ đã được phát triển trên nhánh PR. **Chưa merge / chưa đưa production.**
- Test Firebase Realtime độc lập: `https://nguyenhoangninh.github.io/cashflow/realtime-connection-test.html`; chỉ gửi tín hiệu `config/main.__rtTest`, không ghi dữ liệu giao dịch.
- ChatGPT đọc trực tiếp Firestore: chưa thực hiện; cần MCP/API OAuth read-only riêng biệt.

## BẮT BUỘC — Sao lưu JSON ĐẦY ĐỦ trước khi merge

Website cũ đặt dữ liệu giao dịch trong localStorage nhưng giữ các giá trị thực tế Cashflow tháng 6–9/2026 trong `src/structure.js`.
Bản sao lưu JSON tạo trước khi cập nhật trang sao lưu **không** chứa phần lịch sử này.

1. Trên đúng máy và đúng browser profile chứa dữ liệu Cashflow, mở:
   `https://nguyenhoangninh.github.io/cashflow/backup-local-cashflow.html`
2. Xác nhận trang hiển thị `Lịch sử Cashflow: N dòng` với **N > 0**, Payment Requests và Receipts đúng.
3. Nhấn **Tải bản sao lưu đầy đủ JSON**. Giữ riêng file cũ và file mới ở nơi lưu trữ được mã hóa do công ty quản lý.
4. Kiểm tra file JSON mới có `cashflowActuals`, `cashflowOpening`, `settings`, `payments`, `receipts`; **KHÔNG upload bản JSON này lên GitHub hoặc gửi cho bên ngoài**.
5. Chỉ sau khi đã sao lưu đủ lịch sử mới merge PR và kích hoạt cloud trong website.
6. Nếu sau merge trang sao lưu báo thiếu lịch sử, dùng bản JSON đã tải từ trước hoặc **file Excel gốc có sheet Cashflow_Summary**. Không xóa dữ liệu localStorage.

## Kiểm thử Realtime trước triển khai
1. Mở `realtime-connection-test.html` trong hai tab.
2. Đăng nhập bằng tài khoản Admin đã xác minh trong mỗi tab.
3. Ở tab A nhấn **Gửi thử Realtime**; tab B phải nhận `SNAPSHOT SERVER/ACK` cho `config/main.__rtTest` mà không refresh.
4. Nhấn **Xóa dấu thử nghiệm** để dọn trường thử; xác nhận tab B nhận sự kiện xóa.

## Sau khi PR được merge vào main
1. Mở `https://nguyenhoangninh.github.io/cashflow/` trong cửa sổ mới, tải lại mạnh nếu service worker còn phiên bản cũ.
2. Website sẽ dùng Firebase Auth khi `firebase-config.js` có project ID thật và Web Config hợp lệ.
3. Đăng nhập Google bằng tài khoản Admin; bảng điều khiển phải hiển thị vai trò `admin`.
4. Khi Firestore trống, mở **Nhập file** (hoặc màn hình import mặc định). Chọn **JSON đầy đủ đã sao lưu**.
5. Kiểm tra Payment Requests, Receipts, lịch sử Cashflow và số dư đầu kỳ trong phần xem trước.
6. Xác nhận nhập và **giữ tab mở**. Import sẽ lưu từng nhóm nhỏ lên Firestore và chỉ đặt `config/main.dataStatus='ready'` sau khi các nhóm được xác nhận. Nếu bị gián đoạn, giữ file JSON và dùng nút khôi phục ở tab Admin sau khi tab cũ đã dừng.
7. Xác nhận trên header: `Realtime đã đồng bộ`; trạng thái `Đang lưu` có thể xuất hiện trong khi server xử lý thay đổi. Nếu offline hoặc chưa đồng bộ, ứng dụng ngừng thao tác chỉnh sửa để tránh thông tin sai lệch.
8. Đối chiếu Opening Balances, số lượng Payments/Receipts/FX, Daily Plan/Weekly Plan, Reconciliation, Actual vs Forecast theo đúng bản dữ liệu nguồn.
9. Mở trang bằng tài khoản được cấp `viewer` và `editor` để kiểm tra phân quyền; chỉ Admin được import toàn bộ và sửa cấu hình.
10. Không xóa bản backup và dữ liệu localStorage cũ cho đến khi đối chiếu hoàn tất.

## Giới hạn kỹ thuật và bảo mật
- Firestore `onSnapshot({includeMetadataChanges:true})` cập nhật khi dữ liệu đổi và cho thấy dữ liệu local đang chờ server ack. Không bảo đảm kết nối trong thời gian mất Internet.
- UI sử dụng `memoryLocalCache()`, không lưu Firestore vào IndexedDB trên trình duyệt.
- Import thực hiện nhiều batch nhỏ nên **không atomic**; app có trạng thái `importing` để tránh hiển thị dataset chưa hoàn tất, có đường khôi phục bằng bản sao lưu.
- Quy tắc `members/{UID}` là nguồn phân quyền; browser không được tự nâng quyền.
- Những con số lịch sử trước đây đã có trong mã nguồn công khai. **Loại bỏ khỏi source mới không xóa được lịch sử Git, các fork, bản clone và cache**, cần kế hoạch rà soát/thu hồi quyền phù hợp với phân loại dữ liệu SVL.
- Không lưu service account private key trong GitHub/ChatGPT. Trực tiếp đọc Firestore qua ChatGPT cần endpoint riêng có xác thực OAuth/MCP, giới hạn quyền và audit log.
