# Dui Social POS

App bán hàng cho Dui Social, chạy trên Cloudflare Workers + D1 + R2. Một Worker phục vụ cả API lẫn app (PWA), bán được khi mất mạng và tự đồng bộ khi có mạng lại. Giao diện mẫu "Quầy đêm", tiếng Việt.

## Cài đặt lần đầu

Cần Node 20+ và tài khoản Cloudflare.

```bash
npm install
npx wrangler login
npx wrangler d1 create dui-pos            # chép database_id in ra vào wrangler.jsonc
npx wrangler r2 bucket create dui-pos-media
npm test                                   # 25 kiểm tra: BOGO, ngày kinh doanh, VietQR, API, kho, két
npm run deploy                             # build + migrate D1 + deploy
```

Mở link `*.workers.dev` trên điện thoại Android bằng Chrome → menu ⋮ → "Thêm vào màn hình chính".

1. Máy đầu tiên: màn **Thiết lập lần đầu** tạo quán, tài khoản chủ quán (PIN 6 số) và Máy A.
2. Máy thứ hai, laptop: mở cùng link, chủ quán nhập PIN để đăng ký (Máy B, C…). Mã đơn theo máy: A-001, B-001.
3. Vào **Quản trị**: nhập món, gắn nhóm tuỳ chọn, chọn 5 món signature trong **Khuyến mãi**, nhập tài khoản **VietQR** trong **Cài đặt**, thêm nhân viên.

## Chạy trên máy để phát triển

```bash
npm run db:migrate:local
npm run dev:api        # Worker + D1 local ở :8787
npm run dev            # app ở :5173, gọi /api qua proxy
```

## Cấu trúc

| Thư mục | Nội dung |
| --- | --- |
| `migrations/` | Schema D1 (tiền là số nguyên VND, ID là ULID tạo trên máy) |
| `shared/` | Luật dùng chung app + Worker: BOGO, ngày kinh doanh (cut-off), VietQR, hash PIN |
| `worker/` | API: đồng bộ, đóng két + Z-report, quản trị, kho, giá vốn, tài chính, báo cáo |
| `src/pos/` | Màn bán hàng S01–S23 |
| `src/admin/` | Back office S24–S31 + kho, giá vốn, tài chính, báo cáo |
| `test/` | Kiểm tra end-to-end chạy bằng Node (`node:sqlite` thay cho D1) |

## Đã có (P1)

- **Bán hàng**: lưới món theo danh mục, bấm 1 lần thêm món, giữ lâu để chọn tuỳ chọn, ghi chú, tên/số gọi khách, loại đơn.
- **BOGO**: ghép chéo giữa các món được chọn, ly rẻ hơn miễn phí; 3 ly miễn 1, 4 ly miễn 2; bản mocktail không được tính. Có khung giờ, ngày.
- **Thanh toán**: tiền mặt (gợi ý mệnh giá, tiền thối), VietQR tạo QR ngay trên máy (cả khi offline), "Chờ xác nhận" để bán tiếp, thẻ (chỉ lưu mã chuẩn chi), kết hợp.
- **Két chung, ca theo người**: người đầu tiên mở két; mỗi người bắt đầu/kết thúc ca riêng; đóng két đếm mệnh giá, so với dự kiến, bắt ghi chú khi chênh; Z-report.
- **Thu/chi két** (đá, trái cây…), vượt hạn mức cần quản lý duyệt.
- **Huỷ đơn (void)**: bắt buộc lý do + PIN quản lý, ghi nhật ký, trả lại kho. Đơn đã thanh toán không sửa, không xoá.
- **Offline**: đơn lưu IndexedDB, hàng đợi outbox, tự gửi khi có mạng; màn Đồng bộ.
- **Quản trị**: menu dùng chung website (`GET /api/public/menu`), ảnh lên R2, tuỳ chọn có giá và trừ kho riêng, nhân viên + vai trò, cài đặt, thiết bị (khoá máy mất), nhật ký chỉ đọc.
- **Kho**: đơn vị mua ↔ đơn vị dùng, yield, giá vốn bình quân gia quyền, cảnh báo sắp hết + danh sách cần mua theo NCC, phiếu nhập (ảnh hoá đơn, trả từ két/chuyển khoản/nợ/tiền chủ), kiểm kê ra hao hụt ml và tiền, pha mẻ syrup/rượu ngâm.
- **Công thức**: theo món, theo tuỳ chọn (số âm cho bản mocktail), sub-recipe lồng nhau; tự trừ kho khi đơn thanh toán.
- **Giá vốn**: cost/ly, cost %, lãi gộp, cost % thật khi BOGO, mô phỏng nguyên liệu tăng giá.
- **Tài chính**: tổng quan theo khoảng ngày có so kỳ trước, dòng tiền và lãi lỗ tách riêng, theo giờ, món bán chạy, sổ thu chi có chứng từ.
- **Báo cáo thuế**: tháng/quý/năm, xuất CSV mở bằng Excel, danh sách đơn huỷ, lũy kế năm so với ngưỡng cấu hình. Không có tỷ lệ thuế nào viết cứng trong code.

## Chưa làm (P2/P3)

In hoá đơn Bluetooth (sẽ bọc PWA bằng Capacitor), tab mở và chia bill, giảm giá thủ công, hoàn tiền một phần, webhook ngân hàng tự xác nhận chuyển khoản, bar display, chi phí định kỳ, menu engineering, khoá sổ tháng, tích hợp hoá đơn điện tử, nhiều outlet.

## Lưu ý vận hành

- **Đóng két cần mạng**, để cộng tiền mặt từ tất cả máy. Bán hàng thì không cần.
- **Chạy được trên Workers Free** (10 ms CPU mỗi request). Vì vậy PIN được băm nhẹ (PBKDF2 2.000 vòng). Bù lại:
  - Chủ quán và quản lý bắt buộc PIN 6 số; nhân viên 4–6 số.
  - Trên server, sai PIN 5 lần thì khoá 15 phút (theo nhân viên, và theo IP khi đăng ký máy).
  - Mã băm PIN được lưu trên máy để đăng nhập offline, nên ai lấy được điện thoại đã mở khoá vẫn có thể dò PIN. Khoá máy mất ngay trong Quản trị › Thiết bị và đổi PIN quản lý.
  - Mã băm ghi kèm số vòng, nên sau này lên gói trả phí có thể tăng lên mà không phải đặt lại PIN.
- Hai máy cùng mở két khi đều offline sẽ tạo hai phiên két; khi có mạng lại, đóng cả hai.
- Hoá đơn điện tử: hỏi kế toán trước khi doanh thu lũy kế chạm ngưỡng đã cài.
