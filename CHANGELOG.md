# Changelog

Số phiên bản hiện ở màn đăng nhập (và cuối menu ☰). Còn giai đoạn thử nên là 0.x; mỗi lần cập nhật tăng số giữa.

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
