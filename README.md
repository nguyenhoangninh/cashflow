# SVL · Dự báo dòng tiền (bản web)

Bản web của file `SVL_Payment_Ver6_Final_Ver_2.xlsm`: dự báo dòng tiền theo ngày và theo tuần, kế hoạch thanh toán,
đối chiếu số dư ngân hàng, Cashflow_Summary (USD'000K) và Opex. Chạy trên trình duyệt, không cần cài đặt,
triển khai trên GitHub Pages, dữ liệu dùng chung qua Firebase (gói Spark miễn phí, không cần Cloud Functions).

## Tính năng

| Tab | Nội dung |
|---|---|
| Tổng quan | Số dư đầu, số dư thấp nhất, số ngày dưới ngưỡng, khoản chi đưa vào kế hoạch, khoản chờ xem xét, lỗi dữ liệu; biểu đồ dòng tiền theo tuần (bộ lọc tháng); cài đặt ngày và ngưỡng |
| Kế hoạch ngày | Daily Plan: số dư VND/USD từng ngày, cảnh báo dưới ngưỡng, gợi ý FX (bấm để thêm giao dịch) |
| Chi tiết ngày | Các khoản chi trong một ngày |
| Thanh toán | Payment Request List: lọc, sửa ngày Lena/ngày chi, danh mục, dự án, cờ; thêm khoản mới |
| Thu, Giao dịch FX, Điều chỉnh NH | Nhập, xem, xóa các dòng Receipts, FX Transactions, Bank Adjustments |
| Đối chiếu | Số dư thực tế theo sao kê, so với kế hoạch, dung sai |
| Số dư đầu | Số dư đầu từng tài khoản, tỷ giá mặc định |
| Lịch dòng tiền | Lịch tháng: thu, chi, số dư cuối ngày theo VND hoặc USD; bấm một ngày để xem chi tiết |
| Kế hoạch tuần, Dòng tiền | Weekly Plan và Cashflow_Summary (USD'000K) với 28 tuần. Dòng tiền xem theo tuần hoặc theo tháng (tháng cộng 4 tuần; số đầu kỳ lấy tuần đầu, số cuối kỳ lấy tuần cuối) |
| Opex | Opex Control theo tháng |
| Kiểm tra dữ liệu | Lỗi của file gốc, các khác biệt có chủ ý so với file, khoản cần xem |
| Nhập file | Đọc file `.xlsm` để nạp dữ liệu ban đầu |

## Cấu trúc thư mục

```
index.html              giao diện (một trang)
css/styles.css          kiểu hiển thị
js/app.js               điều khiển: sự kiện, ghi dữ liệu, nhập file
js/views.js             các màn hình (tạo HTML từ kết quả tính)
js/store.js             lưu dữ liệu: trình duyệt (localStorage) hoặc Firebase
js/format.js            định dạng số, ngày
src/engine.js           phép tính (tái hiện công thức của file Excel)
src/importer.js         đọc file .xlsm bằng SheetJS
src/structure.js        cấu trúc tuần, danh mục, dòng Cashflow (lấy từ file)
src/quality.js          báo cáo kiểm tra dữ liệu
firebase-config.js      cấu hình Firebase (chỉ có khóa công khai của dự án)
firestore.rules         luật truy cập Firestore MẪU (email giả, xem mục Bảo trì)
manifest.json, sw.js    cài đặt như ứng dụng (PWA) và dùng khi mất mạng
vendor/xlsx.full.min.js SheetJS 0.18.5 (đọc Excel)
realtime/index.html     chỉ chuyển hướng về trang chính; không còn bản mã riêng
fixtures/               dữ liệu và số liệu Excel dùng để kiểm thử (không đưa lên repo công khai)
tests/                  kiểm thử (engine, quality, giao diện)
build/make_dataset.mjs  tạo fixtures/dataset.json từ file Excel
```

Chỉ có **một** bản mã: thư mục gốc. Bản `realtime/` cũ đã được gỡ; mọi chỉnh sửa làm ở thư mục gốc.

## Bảo trì: ghi đè dữ liệu Firebase đang tạm khóa

- Ghi đè toàn bộ dữ liệu dùng chung trên Firestore **đang tắt** (cờ `overwriteEnabled` trong `js/app.js`).
  Lý do: thao tác hiện tại không nguyên tử (ghi nhiều đợt, xóa sau khi ghi, không có checksum). Xem báo cáo audit.
- Khi tắt, màn Nhập dữ liệu không hiện nút ghi đè. Nhập lần đầu vào Firestore trống vẫn hoạt động.
- Muốn bật lại: chỉ làm sau khi có import phiên bản (staging + chuyển con trỏ trong một giao dịch), kiểm tra
  số lượng và tổng theo tiền tệ, và có kế hoạch khôi phục.
- `firestore.rules` trong repo là bản **nháp v2** theo vai trò trong `members/{UID}`. Chưa kiểm thử bằng
  Firebase Emulator. Không publish khi chưa: sao lưu luật đang publish, chạy emulator (xem audit T01–T04, T07),
  và kiểm tra thao tác của Editor trên bảng Thanh toán.
- Đã có nhưng app chưa dùng (hàm thuần, có kiểm thử):
  - `src/manifest.js`: số dòng, tổng theo tiền tệ, checksum; so khớp và liệt kê mọi sai lệch.
  - `src/audit.js`: bản ghi audit chỉ lưu các trường thay đổi.
  - `src/staging.js`: lập kế hoạch ghi dữ liệu vào `datasets/{phiên bản}`, kiểm tra lại sau khi đọc, kế hoạch
    kích hoạt và khôi phục bằng con trỏ `config/active` (có điều kiện: chỉ đổi nếu con trỏ còn như đã đọc).
  - `src/revision.js`: sửa một document theo `rev`, phát hiện xung đột và báo trường khác biệt.
  - Kiểm thử: `node --test tests/phase2.test.mjs tests/phase2b.test.mjs`.
- Chưa có: nối `src/staging.js` và `src/revision.js` vào store (cần Emulator); app ghi `auditEvents`;
  khóa số dư đầu kỳ (`accounts`) chỉ cho Admin, phải đổi cùng lúc với app; Rules yêu cầu `rev`.
- **Kiểm thử Rules (T01–T04, T07, audit):** `tests/rules.test.mjs`. Cần Java 11 trở lên và kết nối Internet để
  Firebase tải Emulator lần đầu. Chạy trong thư mục repo:

  ```bash
  npm install
  npm run test:rules
  ```

  Không có Emulator thì các test này được bỏ qua (`npm test` vẫn chạy bình thường). Kết quả mong đợi: 20 test
  đạt. Gửi lại kết quả đầy đủ nếu có test lỗi; không được publish `firestore.rules` khi còn lỗi.

## Chạy thử trên máy

Cần Node.js 18 trở lên để chạy kiểm thử. Không cần build.

```bash
npm install            # chỉ để lấy thư viện xlsm cho kiểm thử
python3 -m http.server 8080
```

Mở `http://localhost:8080`. Lần đầu, vào tab **Nhập file** và chọn file `.xlsm`.

Chạy kiểm thử:

```bash
npm test
# kiểm thử đọc file gốc (tùy chọn):
SVL_XLSM=/duong-dan/SVL_Payment_Ver6_Final_Ver_2.xlsm npm test
```

Bản công khai trên GitHub không có thư mục `fixtures/` (dữ liệu nội bộ), nên các kiểm thử cần fixtures sẽ báo lỗi ENOENT
ở đó. Chạy đầy đủ trên bản có fixtures và file gốc.

Bộ kiểm thử so khớp với số liệu đã lưu của file Excel: 2.277 khoản, Daily Plan 71 dòng, Overview,
Đối chiếu, Weekly, Cashflow và Opex. Các khác biệt đã biết được khẳng định rõ ràng trong kiểm thử, không bị bỏ qua.

## Chế độ lưu dữ liệu

- **Trình duyệt** (mặc định khi `firebase-config.js` còn chữ `REPLACE`): dữ liệu lưu trong localStorage của trình duyệt này.
  Mỗi máy/trình duyệt có dữ liệu riêng.
- **Dùng chung (Firebase)**: nhiều người cùng xem và sửa. Chỉ các tài khoản Google trong `firestore.rules` mới truy cập được.

## Thiết lập Firebase (chế độ dùng chung)

1. Vào [console.firebase.google.com](https://console.firebase.google.com), tạo project mới (gói Spark).
2. **Build > Authentication > Get started**, bật nhà cung cấp **Google**.
3. **Authentication > Settings > Authorized domains**: thêm tên miền GitHub Pages, ví dụ `<tên-người-dùng>.github.io`.
   `localhost` đã có sẵn để thử trên máy.
4. **Project settings > Your apps > Web (</>)**: đăng ký ứng dụng web, sao chép khối `firebaseConfig`
   và dán vào `firebase-config.js`.
5. **Build > Firestore Database > Create database**: chọn chế độ production, chọn vùng gần Việt Nam (ví dụ `asia-southeast1`).
6. Mở `firestore.rules`, thay hai địa chỉ `finance-user-1@example.com` và `finance-user-2@example.com`
   bằng các địa chỉ Google được phép truy cập, rồi đưa luật lên:
   - cách 1: `npm i -g firebase-tools && firebase login && firebase deploy --only firestore:rules`
   - cách 2: dán nội dung `firestore.rules` vào **Firestore > Rules** trên console và bấm Publish.

Không đưa địa chỉ email thật vào mã nguồn công khai. Danh sách email chỉ nằm trong `firestore.rules`.

## Triển khai GitHub Pages

1. Đưa thư mục này lên một repository GitHub (không đưa `node_modules/` lên).
2. **Settings > Pages > Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, thư mục = `/ (root)`.
3. Sau vài phút, ứng dụng chạy ở `https://<tên-người-dùng>.github.io/<tên-repo>/`.
   Đường dẫn này phải nằm trong danh sách *Authorized domains* (chỉ cần tên miền `<tên-người-dùng>.github.io`).

Ứng dụng dùng đường dẫn tương đối nên chạy được trong thư mục con của GitHub Pages.

## Nhập dữ liệu từ file Excel

- Tab **Nhập file**, chọn file `.xlsm`. Ứng dụng đọc các sheet: Overview, Opening Balances, Payment Request List,
  Receipts, FX Transactions, Bank Adjustments, Reconciliation, Opex Control.
- Màn hình hiện số lượng đọc được. Ở chế độ trình duyệt, nhập file thay thế dữ liệu cục bộ sau khi xác nhận
  số bản ghi sẽ bị thay. Các thay đổi nhập tay (kể cả đánh dấu “đã xử lý”) sẽ mất.
  Ở chế độ Firebase đã có dữ liệu, ghi đè đang tạm khóa (xem mục Bảo trì).
- Trước khi đọc, ứng dụng kiểm tra tiêu đề cột ở hàng 2 của sheet Payment Request List. Nếu file đã đổi bố cục,
  ứng dụng dừng và báo ô nào sai, thay vì đọc nhầm dữ liệu.
- Khi ghi lên Firebase, nếu mạng lỗi giữa chừng, ứng dụng báo số thao tác đã ghi. Lúc đó dữ liệu có thể chưa đầy đủ:
  hãy nhập lại file.
- Cột W (số tài khoản người nhận) không được nhập, cố ý.

## Nhập dữ liệu trực tiếp

Dữ liệu thêm bằng tay được kiểm tra trước khi ghi (`src/validate.js`):

- **Khoản thanh toán:** bắt buộc mã (không trùng, không phân biệt hoa thường), số tiền > 0, tiền tệ VND/USD, danh mục
  lấy từ danh sách (khoản thiếu danh mục không vào Cashflow). Hạn thanh toán không được trước ngày yêu cầu.
- **Khoản thu:** số tiền > 0, tiền tệ VND/USD, bắt buộc danh mục. Danh mục mới (chưa có trong các khoản thu) được
  cảnh báo và cần xác nhận, để tránh gõ sai làm khoản thu rơi khỏi Cashflow.
- **Giao dịch FX:** USD và tỷ giá > 0, loại SELL/BUY USD. Nếu nhập VND lệch quá 1% so với USD × tỷ giá, cảnh báo.
- **Điều chỉnh NH:** số tiền > 0 và chọn chiều IN/OUT (dấu do chiều quyết định).
- **Sửa trực tiếp trong bảng Thanh toán:** không xóa trắng được danh mục.
- **Nhập lại file Excel** xóa toàn bộ dữ liệu nhập tay. Hộp xác nhận nêu số khoản thanh toán nhập tay và số dòng thu,
  FX, điều chỉnh NH sẽ bị thay. Muốn giữ lại, hãy ghi lại trước khi nhập.

## Cách tính (tóm tắt)

- **Trạng thái khoản chi (cột AB)**: `Paid` nếu đã có ngày chi; `No` nếu cờ là Old/Cancel/Void;
  `Lỗi dữ liệu` nếu thiếu công thức trong file gốc và chưa đánh dấu đã xử lý; `Review` nếu có cờ khác;
  `Yes` nếu hợp lệ và trong kỳ; `—` ngoài kỳ hoặc tiền tệ khác VND/USD.
- **Ngày dự kiến (cột Z)**: ngày chi thực tế, nếu không thì ngày Lena, rồi hạn thanh toán, rồi ngày yêu cầu;
  không bao giờ sớm hơn ngày bắt đầu dự báo.
- **Daily Plan**: số dư cuối = đầu + thu − chi ± FX ± điều chỉnh ngân hàng. Dưới ngưỡng (VND 200.000.000,
  USD 100.000) thì báo *SHORT*, kèm gợi ý bán/mua USD để lấp.
- **Cashflow_Summary**: đơn vị USD'000K. Tuần thực tế (6.1–9.4) lấy số đã nhập; tuần dự báo tính từ danh sách thanh toán và thu.
  Có hai chế độ liên kết số dư đầu tuần 11.1–12.4 (xem bên dưới).

## Khác biệt có chủ ý so với file Excel

Các mục dưới đây được tính lại trên dữ liệu đã nhập; con số là tại thời điểm nhập file. Tab **Kiểm tra dữ liệu** luôn hiển thị số hiện tại.

1. **Liên kết số dư đầu kỳ (Cashflow_Summary V8:AC8).** Trong file, số dư đầu của tuần 11.1–12.4 lấy từ cuối tuần cách 4 cột trước
   (V8 = R58, W8 = S58, …). Đây là lỗi công thức: số dư cuối 11.1 trong file lệch khoảng 2.300 nghìn USD so với chuỗi đúng.
   App mặc định dùng chuỗi đúng (cuối tuần trước). Chọn **Như file gốc (V8:AC8)** ở tab Dòng tiền để xem đúng số trong file.
2. **Cột AK (USD'K) nhập tay hoặc sai dòng.** Dòng 1453 (tuần 10.1) nhập tay 24,52 thay vì công thức 16,93 (+7,59 chi).
   Dòng 2158 (tuần 10.3) tham chiếu cột D thay cột E (thiếu 55,60 chi). App tính lại từ số tiền và tỷ giá.
   Tổng cộng các ô AK trong dự báo làm chi trong file ít hơn app 48,01 nghìn USD.
3. **Weekly Plan.** Số dư cuối tuần của app có cộng điều chỉnh ngân hàng; bảng Weekly trong file thì không.
4. **Thống kê Overview (C26:C28).** File chỉ tính 48 dòng đầu (đến 17/11). App tính cả kỳ đến 31/12.
5. **Ngày bắt đầu kế hoạch để trống.** App lấy ngày sau đối chiếu gần nhất. File gốc đi nhánh thủ công khi ô này trống.
6. **Opex Control** không nối với Cashflow trong file gốc; app giữ nguyên như vậy.

## Dữ liệu nguồn cần làm sạch

- **17 khoản thiếu công thức** Z/AB/AD, cộng 3 dòng rác bên dưới (trong đó có dòng 2037, USD 1.500.000, và dòng 2038, VND 20 tỷ, cùng đến hạn 05/10). File gốc không đưa vào kế hoạch;
  app cũng vậy cho tới khi bạn đánh dấu “đã xử lý”. Hãy kiểm tra từng khoản trước khi đánh dấu.
- **3 dòng rác 4741–4743** (có số tiền, không có mã, tiền tệ hay ngày). Không vào kế hoạch; nên xóa khỏi file gốc.
- **Một khoản không có danh mục** (dòng 2118, mã CASH, tuần 10.1, khoảng 3,8 nghìn USD). Không vào Cashflow, giống file gốc.
- **Nhãn “Others (R&M, Travel, Prof. Fee, IT, etc.)”** là dòng tổng phụ (dòng 35) của Cashflow. Khoản gắn nhãn này sẽ không vào Cashflow,
  nên app ẩn nhãn này khỏi danh sách chọn.
- **Dòng 1680, 1850, 1851, 1852 và 1858** có ô AK trống (không có công thức). Đều là khoản đã chi trong tháng 8–9, nên không ảnh hưởng dự báo.
- Nhãn danh mục trong file có khoảng trắng đầu dòng; app bỏ khoảng trắng khi so khớp.

## Giới hạn hiện tại

- Chế độ dùng chung (Firebase) đã được viết theo API chuẩn của Firebase 10 nhưng **chưa thử với project thật**.
  Nên thử lần đầu với vài bản ghi trước khi nhập toàn bộ.
- Chưa có tài khoản quản trị riêng: ai có email trong `firestore.rules` đều sửa được mọi dữ liệu.
- Ứng dụng không tự gửi dữ liệu ra ngoài; toàn bộ tính toán chạy trên trình duyệt.
