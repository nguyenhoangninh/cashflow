# HƯỚNG DẪN KÍCH HOẠT FIREBASE — SVL CASHFLOW
**Ngày chuẩn bị:** 17/11/2026 · **Trạng thái:** Cấu hình mã nguồn trên PR #1, chưa kích hoạt Firebase thực tế.

## Tình trạng hiện tại
- Website: https://nguyenhoangninh.github.io/cashflow/
- GitHub: https://github.com/nguyenhoangninh/cashflow
- `firebase-config.js` đang chứa `REPLACE_...`. Nếu chưa sửa, ứng dụng vẫn lưu vào `localStorage` của từng trình duyệt.
- `firestore.rules` đã được chuẩn bị theo Firebase UID, quyền `viewer`, `editor`, `admin`, nhưng CHƯA có hiệu lực trong Firestore cho đến khi được triển khai qua Firebase Console / CLI.
- **GitHub connector không phải Firebase connector:** đọc/ghi GitHub không đồng nghĩa với quyền tạo Firebase project hay đọc Firestore.

## Giai đoạn 0 — Sao lưu và bảo mật (bắt buộc trước khi triển khai)
1. Sao lưu file XLSM gốc và dữ liệu đã chỉnh sửa trong trình duyệt hiện tại.
2. Khi bản PR được kiểm tra và được merge nhưng Firebase web config vẫn để placeholder, vào **Nhập file** → **Sao lưu toàn bộ dữ liệu (JSON riêng tư)**. Chỉ dùng thiết bị tin cậy, giữ trong thư mục được mã hóa / công ty kiểm soát.
3. **KHÔNG** commit file JSON/XLSM vào GitHub, không chia sẻ file sao lưu qua dịch vụ công khai.
4. **Cảnh báo ưu tiên cao:** `src/structure.js` có chứa lịch sử Cashflow/Số dư ngân hàng thực tế. Do repo hiện tại public, phải chuyển lịch sử tài chính sang dữ liệu được xác thực và xử lý cả Git history trước khi đưa hệ thống chứa dữ liệu thật vào production. Việc xóa ở commit mới không xóa phiên bản cũ.

## Giai đoạn 1 — Tạo Firebase Project (thực hiện bằng tài khoản tổ chức)
1. Mở https://console.firebase.google.com/ và chọn **Add project**. Dùng một project riêng cho SVL Cashflow do doanh nghiệp sở hữu (ví dụ: đặt display name `SVL Cashflow`; Project ID là do Firebase cấp và phải là duy nhất).
2. Chọn gói phù hợp với chính sách của doanh nghiệp, tạo tài khoản billing khi Firebase yêu cầu. Không giả định dự án luôn nằm trong hạn mức miễn phí.
3. Firebase Console → **Authentication** → **Sign-in method** → bật **Google** (cung cấp project support email nếu được yêu cầu).
4. Authentication → **Settings** → **Authorized domains** → thêm **`nguyenhoangninh.github.io`** (chỉ hostname, không có `https://` hoặc đường dẫn `/cashflow`).
5. **Build → Firestore Database → Create database** → chọn **production mode**, database `(default)`, vùng thích hợp (ví dụ `asia-southeast1` nếu khả dụng). Quyết định vùng trước khi tạo vì đây là lựa chọn khó/không thể thay đổi.
6. **Project settings → General → Your apps → Web app**: đăng ký ứng dụng Web. Lấy Firebase Web Config (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId). Đây là cấu hình client (không phải service-account key).
7. Không tải file private key/service account lên GitHub hoặc gửi private key vào ChatGPT. Firebase Web API key có thể nằm trong mã client với hạn chế API phù hợp, nhưng không thay thế Security Rules.

## Giai đoạn 2 — Triển khai Firestore Rules **trước** khi kích hoạt cloud
1. Mở file `firestore.rules` của PR và review logic `members/<UID>`.
2. Firebase Console → Firestore Database → **Rules**, dán toàn bộ nội dung `firestore.rules`, **Publish**.
   Hoặc sau khi đã cài Firebase CLI, đăng nhập và chọn đúng project:
   ```bash
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules
   ```
3. Xác nhận rằng **người dùng chưa đăng nhập**, **người dùng Google chưa cấp quyền** đều không thể đọc/ghi dữ liệu.
4. Đánh giá hiệu năng: các luật đọc `members/{uid}` khi thực hiện thao tác dữ liệu; giao dịch có nhiều writes đã được chia batch nhỏ hơn, vẫn cần kiểm thử trong Emulator trước khi nhập dữ liệu lớn.

## Giai đoạn 3 — Kích hoạt kết nối Firebase Web
1. Thay giá trị placeholder trong `firebase-config.js` bằng **Web App Config** thực của dự án.
2. Review mã và gửi qua PR riêng; merge sau khi Rules đã được Publish và kiểm thử.
3. Tải lại Cashflow; bạn sẽ thấy nút **Đăng nhập Google** thay vì chế độ lưu trên trình duyệt.
4. Đăng nhập Google bằng tài khoản được công ty phê duyệt. Màn hình sẽ hiện **Firebase UID** của tài khoản (nhưng lúc này chưa có quyền đọc dữ liệu).

## Giai đoạn 4 — Cấp quyền Admin lần đầu
1. Firebase Console → **Firestore Database → Data**.
2. Tạo collection `members`.
3. Tạo document có **Document ID** đúng bằng UID hiển thị trên Cashflow.
4. Thêm trường `role` (string) với giá trị `admin`.
5. Không cho ứng dụng web ghi vào `members`: chỉ người có quyền quản trị Firebase Console / backend được phép tạo, sửa, thu hồi vai trò.
6. Khi quyền đồng bộ, Cashflow sẽ hiển thị `Vai trò: admin`.
7. Tạo thêm từng member theo UID của họ: `viewer` (chỉ đọc), `editor` (cập nhật dữ liệu giao dịch), `admin` (cập nhật cấu hình và thay thế dữ liệu).

## Giai đoạn 5 — Đưa dữ liệu vào Firestore có xác nhận
1. Trước khi bật Cloud, đã có **JSON Backup riêng tư** và file XLSM gốc.
2. Sau khi đăng nhập vai trò admin, vào **Nhập file** → chọn file sao lưu **.json** (ưu tiên nếu có thay đổi thủ công quan trọng); hoặc .xlsm/.xlsx nếu chấp nhận dùng dữ liệu Excel thay thế.
3. Kiểm tra số dòng xem trước, xác nhận thay thế dữ liệu. Nếu database đang có dữ liệu, thao tác này **sẽ thay thế dữ liệu dùng chung**, không tự động hoàn tác.
4. So sánh Overview, Daily, Weekly, Receipts, Payments, FX, Bank Reconciliation với dữ liệu nguồn; kiểm tra mọi cảnh báo SHORT và sai lệch.
5. Kiểm tra trên hai trình duyệt / hai tài khoản (admin và viewer) để bảo đảm dữ liệu đồng bộ mà viewer không thể sửa.
6. Không xóa dữ liệu local backup cũ cho tới khi đối chiếu xong.

## Giai đoạn 6 — Kết nối ChatGPT đọc trực tiếp (chưa triển khai)
- Firebase project + Web Client + Firestore Rules chỉ giúp **website** đọc ghi Firestore có xác thực.
- Để ChatGPT đọc trực tiếp, cần một **backend/MCP server** tách biệt, OAuth người dùng, phân quyền dữ liệu, read-only tools, audit log, và API chỉ trả về trường cần thiết.
- Tuyệt đối không cấp Firebase Admin SDK private key cho trình duyệt, không commit vào GitHub. Trước khi kích hoạt, cần kiểm thử permission denied, dữ liệu bị thu hồi, backup/restore, giới hạn truy vấn và log.

## Khi gặp lỗi
| Lỗi | Kiểm tra |
| --- | --- |
| Website vẫn báo lưu trình duyệt | `firebase-config.js` còn `REPLACE`, PR chưa merge hoặc service-worker cache |
| Google sign-in không hoạt động | Google provider đã bật? `nguyenhoangninh.github.io` đã có ở Authorized domains? |
| Hiện UID nhưng không tải dữ liệu | `members/<UID>` có role hợp lệ? Rules đã Publish? |
| permission-denied | UID chưa được cấp, vai trò không phù hợp, hoặc rule path không khớp |
| Viewer sửa được dữ liệu | **Dừng triển khai**; kiểm tra Firestore Rules đã thực sự Publish và test lại bằng tài khoản khác |
| Đọc data được nhưng lịch sử Cashflow không đúng | Logic lịch sử trong `src/structure.js` cần di chuyển vào dữ liệu xác thực và đối chiếu |

### Kiểm thử được yêu cầu trước merge
- Firebase Emulator Rules test: unauthenticated DENY; signed-in without role DENY; viewer READ only; editor READ & transaction WRITE nhưng config DENY; admin READ & config/import WRITE; role revocation.
- Test giao diện Chrome/mobile, import từ JSON backup và rollback.
- Code review: không có service-account credentials, số tài khoản nhạy cảm và dữ liệu nguồn trong repository public.
