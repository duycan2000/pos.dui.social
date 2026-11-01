# Changelog

Số phiên bản hiện ở màn đăng nhập (và cuối menu ☰). Còn giai đoạn thử nên là 0.x; mỗi lần cập nhật tăng số giữa.

## 0.19.0 — 01/11/2026
- Máy in Bluetooth tự kết nối lại: mở lại app, quay lại app từ nền, hoặc máy in tắt/bật lại thì app tự tìm đúng máy in đã ghép trước đó (không cần chọn lại). Nếu điện thoại không cho tự kết nối, màn bán hàng và sơ đồ bàn hiện dòng "Máy in chưa kết nối — chạm để kết nối lại" (một chạm, danh sách chỉ còn đúng máy in đó). Trạng thái kết nối hiện trong ☰ › Máy in.

## 0.18.0 — 01/11/2026
- Mẫu bill mới theo mẫu quán đưa: tên quán + địa chỉ, tiêu đề (Phiếu tạm tính / Hoá đơn), Số, Ngày (giờ vào - giờ in), Bàn, SL khách, Thu ngân; bảng kẻ ô # · Tên món · SL · ĐG · % KM · TT; Tiền hàng, Tổng thanh toán, Còn phải thu; lời nhắn in đậm, pass wifi; mã QR và dòng "TPB - TÊN TÀI KHOẢN - SỐ TK".
- Chọn ngôn ngữ bill tiếng Anh hoặc tiếng Việt; tuỳ chọn in QR trên cả phiếu tạm tính (Cài đặt › Hoá đơn).

## 0.17.0 — 01/11/2026
- Khách chọn chuyển khoản VietQR: in bill có mã QR (đúng số tiền + nội dung "DUI A012") để khách quét ngay trên giấy; tiền vào là đơn tự xác nhận như QR trên màn hình. Tự in khi chọn chuyển khoản (tắt được trong Máy in), có nút in lại; xem trước "Bill có QR" trong Máy in.

## 0.16.0 — 01/11/2026
- Linh vật Pug "Dui": chú pug vẽ bằng SVG, ló lên ở góc dưới màn hình, vẫy chân, ngoáy đuôi, chớp mắt, kèm câu chào hợp với từng màn.
  - Luôn xuất hiện khi: đăng nhập (chào theo buổi), thanh toán xong (đội mũ tiệc), chấm công vào/ra.
  - Ngoài ra chỉ thỉnh thoảng: tối đa 1 lần mỗi 4 phút, khoảng 1/3 số lần chuyển màn; không hiện ở màn thu tiền.
  - Chạm vào pug để nó đi; tắt/bật trong menu ☰ hoặc Cài đặt › Giao diện.

## 0.15.0 — 01/11/2026
- Màn đăng nhập và trang đăng nhập máy mới có nút "Tải app Android" (bản APK mới nhất trên GitHub). Tự ẩn khi đang mở trong app Android hoặc trên iPhone/iPad.

## 0.14.0 — 01/11/2026
- App sống động hơn, chỉ dùng CSS nhẹ (không thêm thư viện): trang mới trượt lên, danh sách và thẻ hiện lần lượt, số đếm trên nút nảy lên khi đổi, biểu tượng có cử động riêng (đồng bộ xoay khi đang gửi, máy in rung, quà lắc, dấu + xoay), chấm đồng bộ nhấp nháy khi đang gửi/mất mạng.
- Bàn có khách "thở" nhẹ, bàn đã in tạm tính có vòng sóng; màn Đã thanh toán có dấu tích tự vẽ, vòng toả và pháo giấy; mã VietQR có tia quét khi chờ tiền; biểu đồ mọc lên từ trục; số lãi/lỗ đếm lên; cảnh báo đỏ có nhịp đập.
- Tôn trọng cài đặt "Giảm chuyển động" của điện thoại (tắt hết hiệu ứng).

## 0.13.0 — 01/11/2026
- Giao diện sáng (nền trắng, chữ tối) bên cạnh giao diện tối "Quầy đêm". Đổi bằng biểu tượng mặt trời/mặt trăng ở màn đăng nhập, mục "Giao diện sáng/tối" trong menu ☰, hoặc Cài đặt › Giao diện (Tối / Sáng / Theo máy). Mỗi máy nhớ lựa chọn riêng.

## 0.12.0 — 01/11/2026
- Sổ doanh thu bán hàng hóa, dịch vụ theo Mẫu S1a-HKD (Thông tư 152/2025/TT-BTC): giữ đúng bố cục mẫu (A4 ngang, đầu trang lặp lại mỗi trang, cột A/B/1, Tổng cộng, chữ ký người đại diện). Chọn tháng/quý/năm, mỗi đơn một dòng hoặc gộp theo ngày; In / Lưu PDF và Excel.
- Cài đặt › Thông tin hộ kinh doanh: tên hộ/công ty, người đại diện, địa chỉ, địa điểm kinh doanh, mã số thuế, diễn giải.
- Trang Phân tích & cảnh báo: kết luận tuần/tháng (lãi hay lỗ, so với kỳ trước) và các dấu hiệu thất thoát/gian lận: huỷ đơn (nhất là huỷ sau khi đã thu tiền), người huỷ nhiều bất thường, ly mời, bỏ món đã gửi, két thiếu lặp lại, chi két không ảnh, chuyển khoản xác nhận tay, hao hụt kiểm kê, giá vốn vượt mục tiêu, chi phí lương/giờ công, đơn treo.
- Biểu đồ: doanh thu theo ngày (so với kỳ trước), 12 tháng doanh thu và lãi, giờ đông khách, trung bình theo thứ, cách trả tiền, doanh thu theo nhân viên, món bán chạy.

## 0.11.0 — 01/11/2026
- Tắt "kéo xuống để tải lại" của Chrome trong app (cả app Android).
- Nếu app vẫn bị tải lại (mất sóng, Android đóng app chạy nền…), người đang đăng nhập được giữ nguyên và quay về đúng màn đang làm (đơn đang chọn vẫn còn). Chỉ khi bấm "Khoá máy · đổi người" hoặc để yên quá 8 giờ thì mới phải nhập PIN lại.

## 0.10.0 — 01/11/2026
- Nút −1 trên ô món (bấm ô = +1, bấm viên "− 2" ở góc = bớt 1) để sửa khi lỡ bấm 2 lần.
- Trong đơn (giỏ / tab / bàn) mỗi món có − số lượng +. Món chưa gửi: bớt/thêm ngay (về 0 thì xoá). Món đã gửi quầy bar: + tạo lượt mới, − cần quản lý duyệt + lý do và ghi nhật ký.
- Sơ đồ bàn: chủ quán có nút + để thêm bàn ngay tại chỗ (tên, khu vực, số ghế). Chỉ chủ quán được thêm/sửa/xoá bàn (kể cả trong Quản trị).

## 0.9.0 — 01/11/2026
- Chủ quán và quản lý có tài khoản đăng nhập (email hoặc tên) + mật khẩu. Máy lạ chỉ thấy trang đăng nhập (không hiện tên nhân viên hay dữ liệu quán) và phải đăng nhập bằng tài khoản này; PIN không còn đủ để thêm máy mới. Máy đã đăng nhập vẫn chọn tên + PIN như cũ.
- Quán đang dùng từ trước: vẫn đăng ký máy bằng PIN quản lý cho tới khi chủ quán đặt mật khẩu (Quản trị › Nhân viên › tên mình). Trang Quản trị hiện nhắc nếu chưa đặt.
- Quản trị › Thiết bị: "Đăng xuất tất cả máy khác".
- Chặn Google và các công cụ tìm kiếm lưu trang (robots.txt, noindex).
- Thử sai mật khẩu 5 lần: khoá 15 phút (theo tài khoản và theo mạng).

## 0.8.0 — 01/11/2026
- Chủ quán xoá được nhân viên (Quản trị › Nhân viên › chọn người › Xoá nhân viên). Người chưa có dữ liệu thì xoá hẳn; người đã có đơn/chấm công thì ẩn khỏi mọi danh sách và máy bán hàng, nhưng tên vẫn giữ trên đơn, bảng công, nhật ký cũ. Không xoá được khi người đó đang trong ca hoặc còn bàn/tab chưa thanh toán, không tự xoá chính mình, luôn còn ít nhất một chủ quán.

## 0.7.0 — 01/11/2026
- Mẫu bill mới bằng tiếng Anh, gọn và rõ: tên quán, dải tiêu đề BILL / RECEIPT, số đơn, bàn, số khách, giờ, người phục vụ; món theo tên tiếng Anh trong Menu kèm tuỳ chọn; Subtotal / Buy 1 Get 1 / Complimentary chỉ hiện khi có; tổng VND; tiền khách đưa, tiền thối, tip.
- Xem trước cả "Bill tạm tính" và "Hoá đơn đã trả" trong Máy in.
- Hiện số phiên bản ở màn đăng nhập và trong menu.

## 0.6.0 — 01/11/2026
- Sơ đồ bàn (mở bàn, gửi món, in tạm tính, chuyển/gộp bàn, thanh toán), chỉnh sơ đồ trong Quản trị.
- Chấm công vào/ra ca, bảng công, lịch làm, lương giờ.
- App Android (Trusted Web Activity) build bằng GitHub Actions.

## 0.5.0 — 31/10/2026
- Máy in DM01 58mm, in bill cho khách, dữ liệu demo tháng trước + nút xoá demo.

## 0.4.0
- Giao diện mới "Quầy đêm" v2.

## 0.3.0
- Ly mời, tab mở, tip, tự xác nhận chuyển khoản (SePay/Casso), cài máy in Bluetooth.

## 0.2.0
- Chạy trên Cloudflare Workers Free (PIN băm nhẹ, khoá sau 5 lần sai).

## 0.1.0
- Bản đầu: bán hàng offline, két chung, BOGO, VietQR, kho, công thức, tài chính, báo cáo.
